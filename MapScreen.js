import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  Modal,
  TextInput,
  Image,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapboxGL from '@rnmapbox/maps';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
// Conditional import for expo-av to handle cases where it's not available
let Video = null;
try {
  const AV = require('expo-av');
  Video = AV.Video;
} catch (error) {
  console.warn('expo-av not available:', error.message);
}
import { supabase } from './supabase';
import { evaluateSpot, reEvaluateSpot } from './lib/ratings';
import locationService from './lib/locationService';

export default function MapScreen({ user, onLogout }) {
  const [pins, setPins] = useState([]);
  const [center, setCenter] = useState([-96.334407, 30.627977]); // College Station, TX
  const [userLocation, setUserLocation] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [proximityRadius] = useState(50); // 50 meters
  const [trackingInterval, setTrackingInterval] = useState(null);
  const [nearbySpots, setNearbySpots] = useState(new Set());
  const [devMode] = useState(__DEV__); // Development mode for testing
  const [manualTrafficLevel, setManualTrafficLevel] = useState(0);
  const [newPinData, setNewPinData] = useState({ name: '', description: '', media: [] });
  const [currentZoom, setCurrentZoom] = useState(14);
  const [ratingStatus, setRatingStatus] = useState(null); // 'evaluating', 'success', 'pending', 'error'
  const [heatmapData, setHeatmapData] = useState([]);
  const [isLocationTracking, setIsLocationTracking] = useState(false);
  const [liveTrafficData, setLiveTrafficData] = useState(new Map());
  const [showHeatmap, setShowHeatmap] = useState(true);
  
  // Zoom-based UI constants
  const ZOOM_THRESHOLDS = {
    CLOSE_UP: 15,    // Show detailed labels and full pins
    MEDIUM: 13,      // Show simplified pins with minimal info
    FAR_OUT: 11      // Show only basic pins, no labels
  };
  const cameraRef = useRef(null);
  const token = Constants?.expoConfig?.extra?.MAPBOX_PUBLIC_TOKEN || Constants?.manifest?.extra?.MAPBOX_PUBLIC_TOKEN;

  // Traffic color function - defined early to avoid reference issues
  const getTrafficColor = (trafficLevel) => {
    switch (trafficLevel) {
      case 0: return '#22c55e'; // Green - No traffic
      case 1: return '#84cc16'; // Light green - Low traffic
      case 2: return '#eab308'; // Yellow - Medium traffic
      case 3: return '#f97316'; // Orange - High traffic
      case 4: return '#ef4444'; // Red - Very high traffic
      case 5: return '#dc2626'; // Dark red - Maximum traffic
      default: return '#6b7280'; // Gray - Unknown
    }
  };

  // Zoom-based UI helpers
  const shouldShowLabels = () => currentZoom >= ZOOM_THRESHOLDS.CLOSE_UP;
  const shouldShowDetailedPins = () => currentZoom >= ZOOM_THRESHOLDS.MEDIUM;
  const shouldShowMinimalPins = () => currentZoom >= ZOOM_THRESHOLDS.FAR_OUT;
  
  const getPinSize = () => {
    if (currentZoom >= ZOOM_THRESHOLDS.CLOSE_UP) return { width: 64, height: 64 };
    if (currentZoom >= ZOOM_THRESHOLDS.MEDIUM) return { width: 48, height: 48 };
    return { width: 32, height: 32 };
  };

  // Simple clustering function to reduce clutter when zoomed out
  const getClusteredPins = () => {
    // Only cluster when zoomed out significantly
    if (currentZoom >= ZOOM_THRESHOLDS.MEDIUM) {
      return pins; // No clustering when zoomed in
    }

    const clusteredPins = [];
    const processedPins = new Set();
    
    pins.forEach((pin, index) => {
      if (processedPins.has(index)) return;
      
      const cluster = [pin];
      processedPins.add(index);
      
      // Find nearby pins to cluster together
      pins.forEach((otherPin, otherIndex) => {
        if (processedPins.has(otherIndex) || index === otherIndex) return;
        
        // Simple distance calculation (rough approximation)
        const distance = Math.sqrt(
          Math.pow(pin.coordinates[0] - otherPin.coordinates[0], 2) +
          Math.pow(pin.coordinates[1] - otherPin.coordinates[1], 2)
        );
        
        // Much smaller threshold - only cluster very close pins
        const threshold = currentZoom >= ZOOM_THRESHOLDS.FAR_OUT ? 0.005 : 0.003;
        
        if (distance < threshold) {
          cluster.push(otherPin);
          processedPins.add(otherIndex);
        }
      });
      
      // Create cluster pin
      if (cluster.length === 1) {
        clusteredPins.push(pin);
      } else {
        const clusterPin = {
          ...cluster[0], // Use first pin as base
          clusterSize: cluster.length,
          clusterPins: cluster,
          coordinates: [
            cluster.reduce((sum, p) => sum + p.coordinates[0], 0) / cluster.length,
            cluster.reduce((sum, p) => sum + p.coordinates[1], 0) / cluster.length
          ]
        };
        clusteredPins.push(clusterPin);
      }
    });
    
    return clusteredPins;
  };

  // MVP: Improved heatmap data generator
  const generateSimpleHeatmapData = () => {
    return pins
      .filter(spot => (spot.current_users || 0) > 0)
      .map(spot => {
        const userCount = spot.current_users || 0;
        // Create multiple points for higher user counts to make heatmap more visible
        const points = [];
        const baseIntensity = Math.min(1, userCount / 10); // Scale 0-1 based on user count (max 10 users)
        
        // Add main point
        points.push({
          type: 'Feature',
          properties: {
            id: spot.id,
            name: spot.name,
            intensity: baseIntensity,
            userCount: userCount
          },
          geometry: {
            type: 'Point',
            coordinates: spot.coordinates
          }
        });
        
        // Add additional points around the main spot for higher user counts
        if (userCount > 2) {
          const additionalPoints = Math.min(userCount - 1, 5); // Max 5 additional points
          for (let i = 0; i < additionalPoints; i++) {
            const angle = (i / additionalPoints) * 2 * Math.PI;
            const distance = 0.0001; // Small offset (~10 meters)
            const offsetLat = Math.cos(angle) * distance;
            const offsetLng = Math.sin(angle) * distance;
            
            points.push({
              type: 'Feature',
              properties: {
                id: `${spot.id}_${i}`,
                name: spot.name,
                intensity: baseIntensity * 0.7, // Slightly lower intensity for offset points
                userCount: userCount
              },
              geometry: {
                type: 'Point',
                coordinates: [
                  spot.coordinates[0] + offsetLng,
                  spot.coordinates[1] + offsetLat
                ]
              }
            });
          }
        }
        
        return points;
      })
      .flat(); // Flatten the array of arrays
  };

  // Development function to simulate user presence at a spot
  const simulateUserPresence = async (spotId, trafficLevel) => {
    if (!devMode) return;
    
    try {
      console.log(`Setting traffic level ${trafficLevel} for spot ${spotId}`);
      
      const { data, error } = await supabase
        .from('spot_traffic')
        .upsert({
          spot_id: spotId,
          current_users: trafficLevel,
          peak_users: Math.max(trafficLevel, 0),
          traffic_level: trafficLevel,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'spot_id'
        })
        .select();

      if (error) {
        console.error('Error updating traffic:', error);
        Alert.alert('Error', `Failed to update traffic: ${error.message}`);
        return;
      }

      console.log('✅ Traffic updated successfully in database:', data);
      console.log('📊 Updated record:', data?.[0]);
      
      // Update the selected pin immediately for better UX
      if (selectedPin && selectedPin.id === spotId) {
        setSelectedPin(prev => ({
          ...prev,
          current_users: trafficLevel,
          traffic_level: trafficLevel,
          last_updated: new Date().toISOString()
        }));
      }

      // Update pins with new traffic data
      setPins(prevPins => 
        prevPins.map(pin => 
          pin.id === spotId 
            ? { ...pin, current_users: trafficLevel, traffic_level: trafficLevel, last_updated: new Date().toISOString() }
            : pin
        )
      );
      
      console.log(`Successfully simulated ${trafficLevel} users at spot ${spotId}`);
    } catch (error) {
      console.error('Error simulating user presence:', error);
      Alert.alert('Error', `Failed to simulate traffic: ${error.message}`);
    }
  };

  useEffect(() => {
    if (token) {
      MapboxGL.setAccessToken(token);
    }
  }, [token]);

  // Fetch skate spots from Supabase
  useEffect(() => {
    fetchSkateSpots();
  }, []);

  // MVP: Simple location tracking
  useEffect(() => {
    const initializeLocation = async () => {
      try {
        if (user?.id) {
          const locationInitialized = await locationService.initialize(user?.id, {
            updateInterval: 15000, // 15 seconds - less battery drain
            accuracy: Location.Accuracy.Balanced
          });

          if (locationInitialized) {
            await locationService.startTracking();
            setIsLocationTracking(true);
            console.log('Location tracking started');
          }
        }
      } catch (error) {
        console.error('Failed to initialize location:', error);
      }
    };

    initializeLocation();

    return () => {
      locationService.cleanup();
    };
  }, [user?.id]);

  // Auto-update heatmap when pins change
  useEffect(() => {
    if (pins.length > 0) {
      const newHeatmapData = generateSimpleHeatmapData();
      setHeatmapData(newHeatmapData);
    }
  }, [pins]);

  const fetchSkateSpots = async () => {
    try {
      const { data, error } = await supabase
        .from('skate_spots')
        .select(`
          *,
          spot_media!inner(media_url, media_type),
          skate_spot_ratings!left(
            smoothness,
            continuity,
            debris_risk,
            crack_coverage,
            night_visibility,
            hazard_flag,
            confidence,
            notes,
            skateability_score,
            created_at
          ),
          spot_traffic!left(
            current_users,
            peak_users,
            traffic_level,
            last_updated
          )
        `)
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching skate spots:', error);
        return;
      }

      // Transform Supabase data to match our pin format
      const transformedPins = data.map(spot => {
        // Get the latest rating (first one since we ordered by created_at desc)
        const latestRating = spot.skate_spot_ratings && spot.skate_spot_ratings.length > 0 
          ? spot.skate_spot_ratings[0] 
          : null;

        // Get media from spot_media
        const media = spot.spot_media 
          ? spot.spot_media.map(media => ({
              url: media.media_url,
              type: media.media_type,
              metadata: media.metadata || {}
            }))
          : [];
        
        // Get photos for backward compatibility
        const photos = media.filter(m => m.type === 'image').map(m => m.url);

        // Get traffic data from spot_traffic relation
        const trafficData = spot.spot_traffic && spot.spot_traffic.length > 0 
          ? spot.spot_traffic[0] 
          : null;

        return {
          id: spot.id,
          name: spot.name,
          description: spot.description,
          coordinates: [spot.longitude, spot.latitude],
          address: spot.address,
          spot_type: spot.spot_type,
          difficulty_level: spot.difficulty_level,
          media: media,
          photos: photos, // Backward compatibility
          created_at: spot.created_at,
          created_by: spot.created_by,
          latestRating: latestRating,
          // Traffic data
          current_users: trafficData?.current_users || 0,
          peak_users: trafficData?.peak_users || 0,
          traffic_level: trafficData?.traffic_level || 0,
          last_updated: trafficData?.last_updated || null
        };
      });

      setPins(transformedPins);
      console.log('Loaded skate spots:', transformedPins.length);
    } catch (error) {
      console.error('Error fetching skate spots:', error);
    }
  };

  // Request location permission and get user location on startup
  useEffect(() => {
    (async () => {
      try {
        console.log('📍 Requesting location permission...');
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log('📍 Permission status:', status);
        
        if (status === 'granted') {
          console.log('📍 Getting current position...');
          const pos = await Location.getCurrentPositionAsync({ 
            accuracy: Location.Accuracy.Balanced, // Changed from High to Balanced for better compatibility
            timeout: 15000 // Increased timeout
          });
          const coords = [pos.coords.longitude, pos.coords.latitude];
          console.log('📍 User location coordinates:', coords);
          setUserLocation(coords);
          setCenter(coords);
          console.log('📍 User location set successfully');
        } else {
          console.log('📍 Location permission denied, status:', status);
          // Don't set a default location - let user manually request it
        }
      } catch (err) {
        console.log('📍 Location error:', err);
        // Don't set a default location - let user manually request it
      }
    })();
  }, []);

  // Zoom control functions
  const zoomIn = () => {
    const newZoom = Math.min(currentZoom + 1, 20);
    setCurrentZoom(newZoom);
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: newZoom,
      animationDuration: 300,
    });
  };

  const zoomOut = () => {
    const newZoom = Math.max(currentZoom - 1, 1);
    setCurrentZoom(newZoom);
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: newZoom,
      animationDuration: 300,
    });
  };

  const onMapIdle = useCallback(async () => {
    try {
      const current = await cameraRef.current?.getCenter();
      if (Array.isArray(current) && current.length === 2) {
        setCenter(current);
      }
    } catch {}
  }, []);

  // Track zoom changes for UI updates
  const onCameraChanged = useCallback(async () => {
    try {
      const zoom = await cameraRef.current?.getZoom();
      if (zoom && zoom !== currentZoom) {
        setCurrentZoom(zoom);
      }
    } catch {}
  }, [currentZoom]);

  const onPinPress = useCallback((event) => {
    const features = event?.features;
    if (features && features.length > 0) {
      const pinId = features[0].properties?.id;
      const pin = pins.find(p => p.id === pinId);
      if (pin) {
        setSelectedPin(pin);
        setShowDetailsModal(true);
      }
    }
  }, [pins]);

  const openAddPinModal = useCallback(() => {
    if (!userLocation) {
      Alert.alert('Location Required', 'Please enable location services to add a pin.');
      return;
    }
    setNewPinData({ name: '', description: '', media: [] });
    setShowAddModal(true);
  }, [userLocation]);

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera roll permission is needed to add media.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets) {
      const newMedia = result.assets.map(asset => ({
        uri: asset.uri,
        type: asset.type, // 'image' or 'video'
        filename: asset.fileName || `media_${Date.now()}.${asset.type === 'image' ? 'jpg' : 'mp4'}`,
        size: asset.fileSize,
        duration: asset.duration, // for videos
        width: asset.width,
        height: asset.height
      }));

      setNewPinData(prev => ({
        ...prev,
        media: [...prev.media, ...newMedia],
      }));
    }
  };

  const uploadMediaToSupabase = async (mediaItem, spotId) => {
    try {
      const fileExtension = mediaItem.type === 'image' ? 'jpg' : 'mp4';
      const mimeType = mediaItem.type === 'image' ? 'image/jpeg' : 'video/mp4';
      const filename = `${spotId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExtension}`;
      
      console.log(`Uploading ${mediaItem.type}:`, mediaItem.uri, 'as', filename);

      // For testing in simulator, use real media URLs
      if (mediaItem.uri.includes('Library/Caches/ImagePicker')) {
        console.log('Simulator detected - using real media URL');
        if (mediaItem.type === 'image') {
          return 'https://drupal-prod.visitcalifornia.com/sites/default/files/styles/fluid_1920/public/VC_Skateparks_MagdalenaEckeYMCA_Supplied_IMG_5676_RT_1280x640.jpg.webp?itok=Q6g-kDMY';
        } else {
          return 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4';
        }
      }

      const file = {
        uri: mediaItem.uri,
        type: mimeType,
        name: filename,
      };

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('spot-media')
        .upload(filename, file, {
          contentType: mimeType,
          upsert: false
        });

      if (uploadError) {
        console.error(`Error uploading ${mediaItem.type}:`, uploadError);
        return null;
      }

      console.log('Upload successful:', uploadData);
      const { data: { publicUrl } } = supabase.storage
        .from('spot-media')
        .getPublicUrl(filename);

      console.log('Public URL:', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error(`Error uploading ${mediaItem.type}:`, error);
      return null;
    }
  };

  const savePin = useCallback(async () => {
    if (!newPinData.name.trim()) {
      Alert.alert('Name Required', 'Please enter a name for this pin.');
      return;
    }

    try {
      // Save to Supabase
      const { data, error } = await supabase
        .from('skate_spots')
        .insert({
          name: newPinData.name,
          description: newPinData.description,
          latitude: userLocation[1], // userLocation is [lng, lat]
          longitude: userLocation[0],
          spot_type: 'street', // Default type
          difficulty_level: 3, // Default difficulty
          is_public: true,
          is_verified: false,
          created_by: user?.id
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving pin:', error);
        Alert.alert('Error', 'Failed to save pin. Please try again.');
        return;
      }

      // Upload media files and get URLs
      const uploadedMedia = [];
      for (const mediaItem of newPinData.media) {
        const mediaUrl = await uploadMediaToSupabase(mediaItem, data.id);
        if (mediaUrl) {
          uploadedMedia.push({
            url: mediaUrl,
            type: mediaItem.type,
            duration: mediaItem.duration,
            width: mediaItem.width,
            height: mediaItem.height
          });
          
          // Save media reference to database
          await supabase
            .from('spot_media')
            .insert({
              spot_id: data.id,
              media_url: mediaUrl,
              media_type: mediaItem.type,
              uploaded_by: user?.id,
              metadata: {
                duration: mediaItem.duration,
                width: mediaItem.width,
                height: mediaItem.height
              }
            });
        }
      }

      // Transform the saved data to match our pin format
      const newPin = {
        id: data.id,
        coordinates: [data.longitude, data.latitude],
        name: data.name,
        description: data.description,
        media: uploadedMedia,
        photos: uploadedMedia.filter(m => m.type === 'image').map(m => m.url), // Backward compatibility
        created_at: data.created_at,
        created_by: data.created_by,
        address: data.address,
        spot_type: data.spot_type,
        difficulty_level: data.difficulty_level,
        latestRating: null
      };

      // Add to local state
      setPins(prev => [...prev, newPin]);
      setShowAddModal(false);
      
      // Trigger AI evaluation if we have images
      const firstImage = uploadedMedia.find(m => m.type === 'image');
      if (firstImage) {
        setRatingStatus('evaluating');
        
        const aiResult = await evaluateSpot({
          spotId: data.id,
          imageUrl: firstImage.url,
          userId: user?.id
        });

        console.log('AI evaluation result:', aiResult);

        if (aiResult.success) {
          if (aiResult.pending) {
            setRatingStatus('pending');
            Alert.alert(
              'AI Review Pending', 
              'Your spot has been added! AI analysis is pending review and will be available soon.'
            );
          } else if (aiResult.rating) {
            setRatingStatus('success');
            // Update the pin with the rating
            setPins(prev => prev.map(pin => 
              pin.id === data.id 
                ? { ...pin, latestRating: aiResult.rating }
                : pin
            ));
            Alert.alert(
              'AI Analysis Complete', 
              'Your spot has been analyzed! Check the details to see the AI rating.'
            );
          }
        } else {
          setRatingStatus('error');
          Alert.alert(
            'AI Analysis Failed', 
            'Your spot was added successfully, but AI analysis failed. You can try again later.'
          );
        }
      } else {
        Alert.alert('Success', 'Pin added successfully!');
      }

      // Reset form
      setNewPinData({ name: '', description: '', media: [] });
      setRatingStatus(null);
      
    } catch (error) {
      console.error('Error saving pin:', error);
      Alert.alert('Error', 'Failed to save pin. Please try again.');
      setRatingStatus(null);
    }
  }, [newPinData, userLocation, user]);

  const handleReEvaluate = async (pin) => {
    const firstImage = pin.media?.find(m => m.type === 'image') || pin.photos?.[0];
    if (!firstImage) {
      Alert.alert('No Images', 'This spot needs at least one image for AI analysis.');
      return;
    }

    try {
      setRatingStatus('evaluating');
      
      const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage.url;
      const aiResult = await reEvaluateSpot({
        spotId: pin.id,
        imageUrl: imageUrl,
        userId: user?.id
      });

      console.log('Re-evaluation result:', aiResult);

      if (aiResult.success) {
        if (aiResult.pending) {
          setRatingStatus('pending');
          Alert.alert('Re-evaluation Pending', 'AI analysis is pending review.');
        } else if (aiResult.rating) {
          setRatingStatus('success');
          // Update the pin with the new rating
          setPins(prev => prev.map(p => 
            p.id === pin.id 
              ? { ...p, latestRating: aiResult.rating }
              : p
          ));
          // Update selected pin if it's the same one
          if (selectedPin?.id === pin.id) {
            setSelectedPin(prev => ({ ...prev, latestRating: aiResult.rating }));
          }
          Alert.alert('Re-evaluation Complete', 'AI analysis has been updated!');
        }
      } else {
        setRatingStatus('error');
        Alert.alert('Re-evaluation Failed', aiResult.error || 'Failed to re-evaluate spot.');
      }
    } catch (error) {
      console.error('Error re-evaluating spot:', error);
      setRatingStatus('error');
      Alert.alert('Error', 'Failed to re-evaluate spot. Please try again.');
    } finally {
      setRatingStatus(null);
    }
  };

  const defaultPinIcon = require('./assets/better-pin.png');

  // Media Gallery Component
  const MediaGallery = ({ media }) => {
    if (!media || media.length === 0) return null;

    return (
      <ScrollView horizontal pagingEnabled style={styles.mediaGallery}>
        {media.map((mediaItem, index) => (
          <View key={index} style={styles.mediaItem}>
            {mediaItem.type === 'image' ? (
              <Image
                source={{ uri: mediaItem.url }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            ) : Video ? (
              <Video
                source={{ uri: mediaItem.url }}
                style={styles.mediaVideo}
                useNativeControls
                resizeMode="contain"
                shouldPlay={false}
                isLooping={false}
              />
            ) : (
              <View style={styles.videoPlaceholder}>
                <Text style={styles.videoPlaceholderText}>VID</Text>
                <Text style={styles.videoPlaceholderLabel}>Video</Text>
                <Text style={styles.videoPlaceholderSubtext}>Video playback not available</Text>
              </View>
            )}
            <View style={styles.mediaOverlay}>
              <Text style={styles.mediaTypeLabel}>
                {mediaItem.type === 'image' ? 'IMG' : 'VID'}
              </Text>
              {mediaItem.type === 'video' && mediaItem.metadata?.duration && (
                <Text style={styles.mediaDuration}>
                  {Math.floor(mediaItem.metadata.duration / 1000)}s
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <MapboxGL.MapView 
        style={styles.map} 
        styleURL="mapbox://styles/mapbox/dark-v11"
        onMapIdle={onMapIdle}
        onCameraChanged={onCameraChanged}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
      >
        <MapboxGL.Camera ref={cameraRef} zoomLevel={14} centerCoordinate={center} />
        
        {/* User location pin - always visible when location is available */}
        {userLocation && (
          <MapboxGL.MarkerView
            id="user-location"
            coordinate={userLocation}
            allowOverlapWithPuck={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userLocationContainer}>
              <View style={styles.userLocationPin}>
                <View style={styles.userLocationDot} />
                <View style={styles.userLocationPulse} />
              </View>
              {/* Traffic indicator for user location in dev mode */}
              {devMode && manualTrafficLevel > 0 && (
                <View style={[
                  styles.userTrafficIndicator,
                  { backgroundColor: getTrafficColor(manualTrafficLevel) }
                ]}>
                  <Text style={styles.userTrafficText}>
                    {manualTrafficLevel}
                  </Text>
                </View>
              )}
            </View>
          </MapboxGL.MarkerView>
        )}
        
        {/* Debug: Show user location status */}
        {devMode && (
          <View style={styles.debugLocationInfo}>
            <Text style={styles.debugLocationText}>
              User Location: {userLocation ? `${userLocation[1].toFixed(4)}, ${userLocation[0].toFixed(4)}` : 'Not set'}
            </Text>
            <Text style={styles.debugLocationText}>
              Zoom: {currentZoom.toFixed(1)} | Pins: {pins.length} | Clustering: Disabled
            </Text>
          </View>
        )}
        
        {/* MVP: Improved Heatmap Layer */}
        {showHeatmap && heatmapData.length > 0 && (
          <MapboxGL.ShapeSource
            id="heatmap-source"
            shape={{
              type: 'FeatureCollection',
              features: heatmapData
            }}
          >
            <MapboxGL.HeatmapLayer
              id="heatmap-layer"
              sourceID="heatmap-source"
              style={{
                heatmapWeight: [
                  'interpolate',
                  ['linear'],
                  ['get', 'intensity'],
                  0, 0,
                  0.1, 0.2,
                  0.3, 0.4,
                  0.5, 0.6,
                  0.7, 0.8,
                  1, 1
                ],
                heatmapIntensity: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 0.3,
                  12, 0.6,
                  15, 1
                ],
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(0, 0, 255, 0)',
                  0.1, 'rgba(0, 255, 255, 0.3)',
                  0.2, 'rgba(0, 255, 0, 0.5)',
                  0.4, 'rgba(255, 255, 0, 0.7)',
                  0.6, 'rgba(255, 165, 0, 0.8)',
                  0.8, 'rgba(255, 0, 0, 0.9)',
                  1, 'rgba(139, 0, 0, 1)'
                ],
                heatmapRadius: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 20,
                  12, 25,
                  15, 35
                ],
                heatmapOpacity: 0.9
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* Smart zoom-based pins with clustering */}
        {pins.map((pin) => {
          const pinSize = getPinSize();
          const showLabels = shouldShowLabels();
          const showDetailed = shouldShowDetailedPins();
          const showMinimal = shouldShowMinimalPins();
          
          // Don't render pins if zoomed out too far
          if (!showMinimal) return null;
          
          return (
            <MapboxGL.MarkerView
              key={pin.id}
              id={String(pin.id)}
              coordinate={pin.coordinates}
              allowOverlap={true}
              allowOverlapWithPuck={false}
              isSelected={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <TouchableOpacity
                onPress={() => {
                  // If it's a cluster, show the first pin or create a cluster overview
                  if (pin.clusterSize && pin.clusterSize > 1) {
                    // For now, show the first pin in the cluster
                    // TODO: Could implement a cluster overview modal later
                    setSelectedPin(pin.clusterPins[0]);
                  } else {
                    setSelectedPin(pin);
                  }
                  setShowDetailsModal(true);
                }}
                activeOpacity={0.8}
              >
                <View style={styles.markerContainer}>
                  {/* Conditional label rendering - only when zoomed in close */}
                  {showLabels && (
                    <View style={[styles.markerLabel, { marginBottom: showDetailed ? 6 : 3 }]}>
                      <Text style={[
                        styles.markerLabelText,
                        { fontSize: showDetailed ? 12 : 10 }
                      ]}>
                        {pin.clusterSize && pin.clusterSize > 1 
                          ? `${pin.clusterSize} spots` 
                          : pin.name
                        }
                      </Text>
                    </View>
                  )}
                   
                   {/* Traffic indicator - always visible when there are users */}
                   {(pin.current_users || 0) > 0 && showDetailed && (
                     <View style={[
                       styles.trafficIndicator,
                       { 
                         backgroundColor: getTrafficColor(pin.traffic_level || 0),
                         borderWidth: (pin.current_users || 0) > 5 ? 3 : 2,
                         borderColor: '#fff',
                         shadowColor: getTrafficColor(pin.traffic_level || 0),
                         shadowOpacity: 0.8,
                         shadowRadius: 4,
                         width: showDetailed ? 28 : 20,
                         height: showDetailed ? 28 : 20,
                         borderRadius: showDetailed ? 14 : 10,
                         top: showDetailed ? -10 : -8,
                         right: showDetailed ? -10 : -8
                       }
                     ]}>
                       <Text style={[
                         styles.trafficIndicatorText,
                         { 
                           fontSize: showDetailed ? ((pin.current_users || 0) > 9 ? 8 : 10) : 8,
                           fontWeight: (pin.current_users || 0) > 5 ? '900' : 'bold'
                         }
                       ]}>
                         {pin.current_users || 0}
                       </Text>
                     </View>
                   )}
                   
                  {/* Pin content based on zoom level */}
                  {pin.photos && pin.photos.length > 0 ? (
                    <>
                      <View style={[
                        styles.markerImageContainer,
                        {
                          width: pinSize.width,
                          height: pinSize.height,
                          borderRadius: showDetailed ? 12 : 8,
                          borderWidth: showDetailed ? 3 : 2,
                          overflow: 'hidden',
                          backgroundColor: '#fff'
                        }
                      ]}>
                        <Image
                          source={{ uri: pin.photos[0] }}
                          style={[
                            styles.markerImage,
                            {
                              width: pinSize.width,
                              height: pinSize.height,
                              borderRadius: showDetailed ? 9 : 6
                            }
                          ]}
                          resizeMode="cover"
                        />
                      </View>
                      <View style={[
                        styles.markerPointer,
                        {
                          borderLeftWidth: showDetailed ? 8 : 6,
                          borderRightWidth: showDetailed ? 8 : 6,
                          borderTopWidth: showDetailed ? 12 : 8,
                          marginTop: -1
                        }
                      ]} />
                    </>
                  ) : (
                    <View style={[
                      styles.snapmapPin,
                      {
                        width: pinSize.width,
                        height: pinSize.height,
                        borderRadius: pinSize.width / 2,
                        borderWidth: showDetailed ? 3 : 2
                      }
                    ]}>
                      <View style={[
                        styles.snapmapPinInner,
                        {
                          width: pinSize.width - 6,
                          height: pinSize.height - 6,
                          borderRadius: (pinSize.width - 6) / 2
                        }
                      ]}>
                        {/* Show cluster size for clustered pins */}
                        {pin.clusterSize && pin.clusterSize > 1 ? (
                          <Text style={[
                            styles.snapmapPinText,
                            { 
                              fontSize: pinSize.width > 40 ? 12 : 10,
                              color: '#fff',
                              fontWeight: '800'
                            }
                          ]}>
                            {pin.clusterSize}
                          </Text>
                        ) : (
                          <>
                            {/* Show traffic count as main content when zoomed out */}
                            {(pin.current_users || 0) > 0 && !showDetailed && (
                              <Text style={[
                                styles.snapmapPinText,
                                { 
                                  fontSize: pinSize.width > 40 ? 12 : 10,
                                  color: '#fff',
                                  fontWeight: '800'
                                }
                              ]}>
                                {pin.current_users}
                              </Text>
                            )}
                            {/* Show spot type icon when no traffic */}
                            {(pin.current_users || 0) === 0 && (
                              <Text style={[
                                styles.snapmapPinIcon,
                                { fontSize: pinSize.width > 40 ? 16 : 12 }
                              ]}>
                                SK
                              </Text>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </MapboxGL.MarkerView>
          );
        })}
      </MapboxGL.MapView>

      {/* Profile Button */}
      <TouchableOpacity 
        onPress={() => setShowProfileMenu(!showProfileMenu)} 
        style={styles.profileButton} 
        activeOpacity={0.8}
      >
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</Text>
        </View>
      </TouchableOpacity>

      {/* Profile Dropdown Menu */}
      {showProfileMenu && (
        <View style={styles.dropdownMenu}>
          <View style={styles.dropdownHeader}>
            <View style={styles.dropdownAvatar}>
              <Text style={styles.dropdownAvatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</Text>
            </View>
            <View style={styles.dropdownUserInfo}>
              <Text style={styles.dropdownUserName}>{user?.name || 'User'}</Text>
              <Text style={styles.dropdownUserEmail}>{user?.email || ''}</Text>
            </View>
          </View>
          
          <View style={styles.dropdownDivider} />
          
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={() => {
              setShowProfileMenu(false);
              Alert.alert('Coming Soon', 'Settings will be available in a future update.');
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={20} color="#6b7280" style={styles.dropdownItemIcon} />
            <Text style={styles.dropdownItemText}>Settings</Text>
            <Ionicons name="chevron-forward" size={16} color="#8e8e93" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={() => {
              setShowProfileMenu(false);
              const status = isLocationTracking ? 'Active' : 'Inactive';
              const userCount = pins.reduce((sum, pin) => sum + (pin.current_users || 0), 0);
              const activeSpots = pins.filter(pin => (pin.current_users || 0) > 0).length;
              Alert.alert(
                'Live Traffic Status', 
                `Location Tracking: ${status}\nTotal Users: ${userCount}\nActive Spots: ${activeSpots}`
              );
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="analytics-outline" size={20} color="#6b7280" style={styles.dropdownItemIcon} />
            <Text style={styles.dropdownItemText}>Live Traffic Status</Text>
            <View style={[styles.statusIndicator, { backgroundColor: isLocationTracking ? '#10b981' : '#ef4444' }]} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={async () => {
              setShowProfileMenu(false);
              try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                  const pos = await Location.getCurrentPositionAsync({ 
                    accuracy: Location.Accuracy.Balanced,
                    timeout: 15000
                  });
                  const coords = [pos.coords.longitude, pos.coords.latitude];
                  setUserLocation(coords);
                  setCenter(coords);
                  Alert.alert('Success', 'Your location has been updated!');
                } else {
                  Alert.alert('Permission Denied', 'Location permission is required to show your position on the map.');
                }
              } catch (error) {
                console.error('Error updating location:', error);
                Alert.alert('Error', 'Failed to update location. Please try again.');
              }
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="location-outline" size={20} color="#6b7280" style={styles.dropdownItemIcon} />
            <Text style={styles.dropdownItemText}>Update My Location</Text>
            <Ionicons name="chevron-forward" size={16} color="#8e8e93" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.dropdownItem}
            onPress={() => {
              setShowProfileMenu(false);
              Alert.alert('Coming Soon', 'Profile edit will be available in a future update.');
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownItemText}>Edit Profile</Text>
          </TouchableOpacity>
          
          <View style={styles.dropdownDivider} />
          
          <TouchableOpacity 
            style={[styles.dropdownItem, styles.dropdownItemDanger]}
            onPress={() => {
              setShowProfileMenu(false);
              onLogout();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownItemIcon}>→</Text>
            <Text style={[styles.dropdownItemText, styles.dropdownItemTextDanger]}>Log Out</Text>
          </TouchableOpacity>
          
          {/* MVP: Simple dev controls */}
          {devMode && (
            <>
              <View style={styles.dropdownDivider} />
              <View style={styles.devMenuSection}>
                <Text style={styles.devMenuTitle}>Development Tools</Text>
                
                <View style={styles.devButtonGrid}>
                  <TouchableOpacity
                    style={[styles.devTestButton, styles.devButtonPrimary]}
                    onPress={async () => {
                      setShowProfileMenu(false);
                      try {
                        // Add random users to database for random spots
                        const spotsToUpdate = pins.filter(() => Math.random() > 0.3); // 70% chance each spot gets users
                        const updates = [];
                        
                        for (const spot of spotsToUpdate) {
                          const userCount = Math.floor(Math.random() * 8) + 1; // 1-8 users
                          const trafficLevel = Math.min(5, Math.ceil(userCount / 2));
                          
                          // Update database
                          const { data, error } = await supabase
                            .from('spot_traffic')
                            .upsert({
                              spot_id: spot.id,
                              current_users: userCount,
                              peak_users: Math.max(userCount, 0),
                              traffic_level: trafficLevel,
                              last_updated: new Date().toISOString()
                            }, {
                              onConflict: 'spot_id'
                            })
                            .select();
                          
                          if (!error) {
                            updates.push({ spotId: spot.id, userCount, trafficLevel });
                            console.log(`✅ Added ${userCount} users to spot ${spot.id} in database`);
                            console.log('📊 Updated record:', data?.[0]);
                          } else {
                            console.error(`❌ Failed to add users to spot ${spot.id}:`, error);
                          }
                        }
                        
                        // Update local state
                        setPins(prevPins => 
                          prevPins.map(pin => {
                            const update = updates.find(u => u.spotId === pin.id);
                            if (update) {
                              return {
                                ...pin,
                                current_users: update.userCount,
                                traffic_level: update.trafficLevel,
                                last_updated: new Date().toISOString()
                              };
                            }
                            return pin;
                          })
                        );
                        
                        Alert.alert('Success', `Added random traffic to ${updates.length} spots!`);
                      } catch (error) {
                        console.error('Error adding realistic traffic:', error);
                        Alert.alert('Error', 'Failed to add realistic traffic');
                      }
                    }}
                  >
                    <Ionicons name="shuffle" size={16} color="#3b82f6" style={styles.devButtonIcon} />
                    <Text style={styles.devTestButtonText}>Random Traffic</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.devTestButton, styles.devButtonSecondary]}
                    onPress={() => {
                      setShowProfileMenu(false);
                      // Force set a test user location
                      const testCoords = [-96.334407, 30.627977]; // College Station, TX
                      setUserLocation(testCoords);
                      setCenter(testCoords);
                      console.log('📍 Test user location set:', testCoords);
                      Alert.alert('Success', 'Test user location set!');
                    }}
                  >
                    <Ionicons name="location" size={16} color="#6b7280" style={styles.devButtonIcon} />
                    <Text style={styles.devTestButtonText}>Test Location</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.devTestButton, styles.devButtonDanger]}
                    onPress={async () => {
                      setShowProfileMenu(false);
                      try {
                        // Clear all traffic data
                        const { error } = await supabase
                          .from('spot_traffic')
                          .delete()
                          .neq('spot_id', '00000000-0000-0000-0000-000000000000'); // Delete all records
                        
                        if (!error) {
                          // Reset all pins to no traffic
                          setPins(prevPins => 
                            prevPins.map(pin => ({
                              ...pin,
                              current_users: 0,
                              traffic_level: 0,
                              last_updated: null
                            }))
                          );
                          console.log('✅ All traffic data cleared from database');
                          Alert.alert('Success', 'All traffic data cleared!');
                        } else {
                          console.error('❌ Failed to clear traffic data:', error);
                          Alert.alert('Error', 'Failed to clear traffic data');
                        }
                      } catch (error) {
                        console.error('Error clearing traffic:', error);
                        Alert.alert('Error', 'Failed to clear traffic data');
                      }
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#dc2626" style={styles.devButtonIcon} />
                    <Text style={styles.devTestButtonText}>Clear All</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      )}

      {/* Overlay to close dropdown */}
      {showProfileMenu && (
        <TouchableOpacity 
          style={styles.dropdownOverlay} 
          activeOpacity={1}
          onPress={() => setShowProfileMenu(false)}
        />
      )}

      {/* Heatmap Toggle - Above Zoom Controls */}
      <TouchableOpacity 
        style={styles.heatmapToggle}
        onPress={() => {
          console.log('Heatmap toggle pressed:', {
            showHeatmap: !showHeatmap,
            heatmapDataLength: heatmapData.length,
            heatmapData: heatmapData
          });
          setShowHeatmap(!showHeatmap);
        }}
        activeOpacity={0.8}
      >
        <Ionicons 
          name="flame" 
          size={24} 
          color={showHeatmap ? '#ff6b35' : '#fff'} 
        />
      </TouchableOpacity>

      {/* Neon Zoom Controls */}
      <View style={styles.zoomControls}>
        <View style={styles.neonContainer}>
          <TouchableOpacity style={styles.neonButton} onPress={zoomIn} activeOpacity={0.7}>
            <Text style={styles.neonButtonText}>+</Text>
          </TouchableOpacity>
          
          <View style={styles.neonDivider} />
          
          <TouchableOpacity style={styles.neonButton} onPress={zoomOut} activeOpacity={0.7}>
            <Text style={styles.neonButtonText}>−</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity onPress={openAddPinModal} style={styles.fab} activeOpacity={0.8}>
        <Ionicons name="add" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Add Pin Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Skate Spot</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Downtown Skate Park"
                value={newPinData.name}
                onChangeText={(text) => setNewPinData(prev => ({ ...prev, name: text }))}
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Add details about this spot..."
                value={newPinData.description}
                onChangeText={(text) => setNewPinData(prev => ({ ...prev, description: text }))}
                multiline
                numberOfLines={4}
              />

              <Text style={styles.label}>Media (Photos & Videos)</Text>
              <ScrollView horizontal style={styles.photoScroll}>
                {newPinData.media.map((mediaItem, idx) => (
                  <View key={idx} style={styles.mediaPreview}>
                    {mediaItem.type === 'image' ? (
                      <Image source={{ uri: mediaItem.uri }} style={styles.photoPreview} />
                    ) : Video ? (
                      <View style={styles.videoPreview}>
                        <Video
                          source={{ uri: mediaItem.uri }}
                          style={styles.photoPreview}
                          shouldPlay={false}
                          useNativeControls={false}
                        />
                        <View style={styles.videoPreviewOverlay}>
                          <Text style={styles.videoPreviewIcon}>VID</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.videoPreviewPlaceholder}>
                        <Text style={styles.videoPreviewIcon}>VID</Text>
                        <Text style={styles.videoPreviewLabel}>Video</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={styles.removeMediaButton}
                      onPress={() => {
                        setNewPinData(prev => ({
                          ...prev,
                          media: prev.media.filter((_, index) => index !== idx)
                        }));
                      }}
                    >
                      <Text style={styles.removeMediaButtonText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={pickMedia} style={styles.addPhotoButton}>
                  <Text style={styles.addPhotoText}>+ Add Media</Text>
                </TouchableOpacity>
              </ScrollView>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => setShowAddModal(false)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={savePin} style={styles.saveButton}>
                <Text style={styles.saveButtonText}>Save Pin</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pin Details Modal */}
      <Modal visible={showDetailsModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.titleContainer}>
                <Text style={styles.modalTitle}>{selectedPin?.name}</Text>
                {selectedPin?.is_verified && (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                )}
              </View>
              <TouchableOpacity 
                onPress={() => setShowDetailsModal(false)}
                style={styles.closeButtonContainer}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <MediaGallery media={selectedPin?.media} />

              {/* Basic Information Section */}
              <View style={styles.infoSection}>
                <Text style={styles.sectionTitle}>Spot Information</Text>
                
                {selectedPin?.address && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Address</Text>
                    <Text style={styles.infoValue}>{selectedPin.address}</Text>
                  </View>
                )}

                {selectedPin?.spot_type && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Type</Text>
                    <Text style={styles.infoValue}>{selectedPin.spot_type.charAt(0).toUpperCase() + selectedPin.spot_type.slice(1)}</Text>
                  </View>
                )}

                {selectedPin?.difficulty_level && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Difficulty</Text>
                    <View style={styles.difficultyContainer}>
                      <Text style={styles.difficultyText}>{selectedPin.difficulty_level}/5</Text>
                      <View style={styles.difficultyStars}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Text key={star} style={[
                            styles.difficultyStar,
                            star <= selectedPin.difficulty_level ? styles.difficultyStarActive : styles.difficultyStarInactive
                          ]}>
                            ★
                          </Text>
                        ))}
                      </View>
                    </View>
                  </View>
                )}

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Live Traffic</Text>
                  <View style={styles.trafficContainer}>
                    <View style={styles.trafficHeatmap}>
                      {[1, 2, 3, 4, 5].map((level) => {
                        const isActive = selectedPin?.traffic_level >= level;
                        return (
                          <View
                            key={level}
                            style={[
                              styles.trafficBar,
                              {
                                backgroundColor: isActive ? getTrafficColor(level) : '#e0e0e0',
                                opacity: isActive ? 1 : 0.3,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                    <View style={styles.trafficInfo}>
                      <Text style={styles.trafficLabel}>
                        {selectedPin?.current_users || 0} users
                      </Text>
                      {selectedPin?.last_updated && (
                        <Text style={styles.trafficTimestamp}>
                          Updated: {new Date(selectedPin.last_updated).toLocaleTimeString()}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
                
                {/* Development mode traffic controls */}
                {devMode && selectedPin && (
                  <View style={styles.devControls}>
                    <Text style={styles.devLabel}>Traffic Simulation</Text>
                    <View style={styles.trafficButtons}>
                      {[0, 1, 2, 3, 4, 5].map((level) => (
                        <TouchableOpacity
                          key={level}
                          style={[
                            styles.trafficButton,
                            { 
                              backgroundColor: getTrafficColor(level),
                              borderColor: selectedPin?.traffic_level === level ? '#fff' : 'rgba(255, 255, 255, 0.3)',
                              borderWidth: selectedPin?.traffic_level === level ? 2 : 1,
                              shadowColor: getTrafficColor(level),
                              shadowOpacity: selectedPin?.traffic_level === level ? 0.4 : 0.2,
                              transform: selectedPin?.traffic_level === level ? [{ scale: 1.05 }] : [{ scale: 1 }],
                            }
                          ]}
                          onPress={() => simulateUserPresence(selectedPin.id, level)}
                          activeOpacity={0.7}
                        >
                          {level === 0 ? (
                            <Ionicons 
                              name="close" 
                              size={16} 
                              color="#fff" 
                            />
                          ) : (
                            <Text style={[
                              styles.trafficButtonText,
                              { 
                                color: '#fff',
                                fontWeight: selectedPin?.traffic_level === level ? '800' : '600',
                                fontSize: selectedPin?.traffic_level === level ? 14 : 12,
                              }
                            ]}>
                              {level}
                            </Text>
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.trafficLegend}>
                      Tap to simulate {selectedPin?.current_users || 0} users at this spot
                    </Text>
                  </View>
                )}
              </View>

              {selectedPin?.description ? (
                <View style={styles.infoSection}>
                  <Text style={styles.sectionTitle}>Description</Text>
                  <Text style={styles.descriptionText}>{selectedPin.description}</Text>
                </View>
              ) : null}

              {/* AI Analysis Section */}
              {selectedPin?.latestRating ? (
                <View style={styles.ratingSection}>
                  <Text style={styles.sectionTitle}>AI Analysis</Text>
                  
                  {/* Hazard Warning */}
                  {selectedPin.latestRating.hazard_flag && (
                    <View style={styles.hazardWarning}>
                      <Text style={styles.hazardText}>HAZARD DETECTED</Text>
                      <Text style={styles.hazardSubtext}>This spot may contain dangerous elements</Text>
                    </View>
                  )}

                  {/* Skateability Score - Top Priority */}
                  <View style={styles.skateabilityScore}>
                    <Text style={styles.skateabilityLabel}>Overall Skateability</Text>
                    <Text style={styles.skateabilityValue}>
                      {selectedPin.latestRating.skateability_score ? selectedPin.latestRating.skateability_score.toFixed(1) : ((selectedPin.latestRating.smoothness + selectedPin.latestRating.continuity + (6 - selectedPin.latestRating.debris_risk) + (6 - selectedPin.latestRating.crack_coverage) + selectedPin.latestRating.night_visibility) / 5).toFixed(1)}/5.0
                    </Text>
                    <Text style={styles.confidenceText}>
                      Confidence: {(selectedPin.latestRating.confidence * 100).toFixed(1)}%
                    </Text>
                  </View>

                  {/* Detailed Report - Bottom Section */}
                  <View style={styles.detailedReportSection}>
                    <Text style={styles.detailedReportTitle}>Detailed Report</Text>
                    <View style={styles.ratingGrid}>
                      <View style={styles.ratingItem}>
                        <Text style={styles.ratingLabel}>Smoothness</Text>
                        <Text style={styles.ratingValue}>{parseFloat(selectedPin.latestRating.smoothness).toFixed(1)}/5.0</Text>
                      </View>
                      <View style={styles.ratingItem}>
                        <Text style={styles.ratingLabel}>Continuity</Text>
                        <Text style={styles.ratingValue}>{parseFloat(selectedPin.latestRating.continuity).toFixed(1)}/5.0</Text>
                      </View>
                      <View style={styles.ratingItem}>
                        <Text style={styles.ratingLabel}>Debris Risk</Text>
                        <Text style={styles.ratingValue}>{parseFloat(selectedPin.latestRating.debris_risk).toFixed(1)}/5.0</Text>
                      </View>
                      <View style={styles.ratingItem}>
                        <Text style={styles.ratingLabel}>Crack Coverage</Text>
                        <Text style={styles.ratingValue}>{parseFloat(selectedPin.latestRating.crack_coverage).toFixed(1)}/5.0</Text>
                      </View>
                      <View style={styles.ratingItem}>
                        <Text style={styles.ratingLabel}>Night Visibility</Text>
                        <Text style={styles.ratingValue}>{parseFloat(selectedPin.latestRating.night_visibility).toFixed(1)}/5.0</Text>
                      </View>
                    </View>

                    {selectedPin.latestRating.notes && (
                      <View style={styles.notesSection}>
                        <Text style={styles.notesLabel}>AI Notes</Text>
                        <Text style={styles.notesText}>{selectedPin.latestRating.notes}</Text>
                      </View>
                    )}

                    <Text style={styles.ratingTimestamp}>
                      Analyzed: {new Date(selectedPin.latestRating.created_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.noRatingSection}>
                  <Text style={styles.noRatingText}>No AI analysis available</Text>
                  <Text style={styles.noRatingSubtext}>Add a photo to get AI-powered spot analysis</Text>
                </View>
              )}

              {/* Developer Controls */}
              {__DEV__ && (selectedPin?.media?.find(m => m.type === 'image') || selectedPin?.photos?.length > 0) && (
                <View style={styles.devControlsSection}>
                  <Text style={styles.devControlsLabel}>Developer Controls</Text>
                  <TouchableOpacity 
                    onPress={() => handleReEvaluate(selectedPin)} 
                    style={[
                      styles.reEvaluateButton,
                      ratingStatus === 'evaluating' && styles.reEvaluateButtonDisabled
                    ]}
                    disabled={ratingStatus === 'evaluating'}
                    activeOpacity={0.8}
                  >
                    <Ionicons 
                      name={ratingStatus === 'evaluating' ? 'hourglass' : 'refresh'} 
                      size={16} 
                      color="#fff" 
                      style={styles.reEvaluateButtonIcon} 
                    />
                    <Text style={styles.reEvaluateButtonText}>
                      {ratingStatus === 'evaluating' ? 'Evaluating...' : 'Re-evaluate with AI'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Metadata Section */}
              <View style={styles.metadataSection}>
                <Text style={styles.sectionTitle}>Details</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Added</Text>
                  <Text style={styles.metaValue}>
                    {selectedPin?.created_at ? new Date(selectedPin.created_at).toLocaleDateString() : 'Unknown'}
                  </Text>
                </View>
                {selectedPin?.created_by && (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>Created by</Text>
                    <Text style={styles.metaValue}>User {selectedPin.created_by.slice(0, 8)}...</Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Spot ID</Text>
                  <Text style={styles.metaValue}>{selectedPin?.id?.slice(0, 8)}...</Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity 
                onPress={() => setShowDetailsModal(false)} 
                style={styles.closeDetailsButton}
                activeOpacity={0.8}
              >
                <Ionicons name="close-circle" size={20} color="#fff" style={styles.closeButtonIcon} />
                <Text style={styles.closeDetailsButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: { flex: 1 },
  profileButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 1000,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backdropFilter: 'blur(20px)',
    transform: [{ scale: 1.02 }],
  },
  profileAvatarText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 116,
    right: 20,
    width: 200,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
    zIndex: 1001,
    overflow: 'hidden',
    backdropFilter: 'blur(20px)',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  dropdownAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dropdownAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  dropdownUserInfo: {
    flex: 1,
  },
  dropdownUserName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1c1c1e',
    marginBottom: 2,
    letterSpacing: -0.1,
  },
  dropdownUserEmail: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    marginHorizontal: 12,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 6,
    marginVertical: 1,
    borderRadius: 8,
  },
  dropdownItemIcon: {
    marginRight: 10,
    width: 16,
    textAlign: 'center',
  },
  dropdownItemText: {
    fontSize: 13,
    color: '#1c1c1e',
    fontWeight: '600',
    flex: 1,
    letterSpacing: -0.1,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  dropdownItemDanger: {
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    marginTop: 4,
  },
  dropdownItemTextDanger: {
    color: '#ff3b30',
    fontWeight: '700',
  },
  zoomControls: {
    position: 'absolute',
    top: 120,
    right: 24,
    flexDirection: 'column',
    backgroundColor: 'transparent',
  },
  neonContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 4,
    paddingHorizontal: 3,
    width: 40,
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    backdropFilter: 'blur(20px)',
    transform: [{ scale: 1.02 }],
  },
  neonButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  neonButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '300',
    letterSpacing: -0.5,
  },
  neonDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 4,
    marginHorizontal: 8,
  },
  neonCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  zoomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },
  zoomButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backdropFilter: 'blur(20px)',
    transform: [{ scale: 1.02 }],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginRight: 12,
    color: '#1c1c1e',
    letterSpacing: -0.5,
  },
  verifiedBadge: {
    backgroundColor: '#22c55e',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  verifiedBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  closeButton: {
    fontSize: 32,
    color: '#666',
    fontWeight: '300',
  },
  closeButtonContainer: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  modalBody: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1c1c1e',
    marginTop: 20,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.12)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: '#fafafa',
    color: '#1c1c1e',
    fontWeight: '500',
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  photoScroll: {
    flexDirection: 'row',
    marginTop: 8,
  },
  photoPreview: {
    width: 100,
    height: 100,
    borderRadius: 8,
    marginRight: 8,
  },
  addPhotoButton: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: {
    color: '#666',
    fontSize: 12,
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.08)',
    gap: 16,
  },
  cancelButton: {
    flex: 1,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.12)',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  cancelButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 0.2,
  },
  saveButton: {
    flex: 1,
    padding: 18,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    shadowColor: '#1c1c1e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  photoPager: {
    height: 250,
    marginBottom: 16,
  },
  detailPhoto: {
    width: 350,
    height: 250,
    borderRadius: 8,
    marginRight: 8,
  },
  descriptionText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#999',
    marginTop: 8,
  },
  closeDetailsButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#1c1c1e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  closeDetailsButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginLeft: 8,
    letterSpacing: 0.2,
  },
  closeButtonIcon: {
    marginRight: 4,
  },
  // AI Rating Styles
  ratingSection: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  hazardWarning: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeaa7',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  hazardText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#856404',
    textAlign: 'center',
  },
  hazardSubtext: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    marginTop: 4,
  },
  ratingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  ratingItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
    alignItems: 'center',
  },
  ratingLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    textAlign: 'center',
  },
  ratingValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1c1c1e',
  },
  notesSection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  notesLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  notesText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  ratingTimestamp: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  noRatingSection: {
    marginTop: 16,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
    alignItems: 'center',
  },
  noRatingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  noRatingSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  // Developer Controls Styles
  devControlsSection: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#e3f2fd',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bbdefb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  devControlsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 12,
  },
  reEvaluateButton: {
    backgroundColor: '#1976d2',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#1976d2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  reEvaluateButtonDisabled: {
    backgroundColor: '#9e9e9e',
    shadowOpacity: 0.1,
  },
  reEvaluateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  reEvaluateButtonIcon: {
    marginRight: 6,
  },
  // Custom Marker Styles
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerImageContainer: {
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#ffffff',
    padding: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    overflow: 'hidden',
  },
  markerImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
    borderWidth: 0,
  },
  markerPointer: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#ffffff',
    marginTop: -3,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  silhouettePinContainer: {
    marginTop: 4,
  },
  defaultMarkerIcon: {
    width: 35,
    height: 42,
    tintColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    alignSelf: 'center',
  },
  markerLabel: {
    marginBottom: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    minWidth: 70,
    maxWidth: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  markerLabelText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    flexWrap: 'wrap',
    letterSpacing: 0.2,
  },
  // Enhanced Modal Styles
  infoSection: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#fafafa',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1c1c1e',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
  },
  infoLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
    flex: 1,
    letterSpacing: -0.1,
  },
  infoValue: {
    fontSize: 15,
    color: '#1c1c1e',
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
    letterSpacing: -0.1,
  },
  difficultyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 2,
    justifyContent: 'flex-end',
  },
  difficultyText: {
    fontSize: 14,
    color: '#1c1c1e',
    fontWeight: '600',
    marginRight: 8,
  },
  difficultyStars: {
    flexDirection: 'row',
  },
  difficultyStar: {
    fontSize: 12,
    marginHorizontal: 1,
  },
  difficultyStarActive: {
    opacity: 1,
  },
  difficultyStarInactive: {
    opacity: 0.3,
  },
  trafficContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 2,
    justifyContent: 'flex-end',
  },
  trafficHeatmap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  trafficBar: {
    width: 4,
    height: 16,
    marginHorizontal: 1,
    borderRadius: 2,
  },
  trafficLabel: {
    fontSize: 12,
    color: '#1c1c1e',
    fontWeight: '600',
  },
  trafficInfo: {
    alignItems: 'flex-end',
  },
  trafficTimestamp: {
    fontSize: 10,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 2,
  },
  trafficIndicator: {
    position: 'absolute',
    top: -10,
    right: -10,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  trafficIndicatorText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  devControls: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(248, 249, 250, 0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  devLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  devSubLabel: {
    fontSize: 10,
    color: '#999',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  trafficButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trafficButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  trafficButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  trafficButtonSubtext: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  trafficLegend: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  trafficLegendText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  userLocationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userLocationPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  userLocationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  userLocationPulse: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
  },
  userTrafficIndicator: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  userTrafficText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
  },
  devMenuSection: {
    padding: 12,
    backgroundColor: 'rgba(248, 249, 250, 0.8)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.06)',
  },
  devMenuTitle: {
    fontSize: 11,
    color: '#666',
    marginBottom: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  devMenuButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  devMenuButton: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 1,
  },
  devMenuButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  devHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  devBadge: {
    backgroundColor: '#6b7280',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  devBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
  },
  devButtonGrid: {
    gap: 6,
  },
  devTestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  devButtonPrimary: {
    backgroundColor: '#3b82f6',
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  devButtonSecondary: {
    backgroundColor: '#6b7280',
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  devButtonDanger: {
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#b91c1c',
  },
  devButtonIcon: {
    marginRight: 6,
  },
  devTestButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    letterSpacing: 0.1,
  },
  metadataSection: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  metaLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  metaValue: {
    fontSize: 13,
    color: '#1c1c1e',
    fontWeight: '600',
  },
  // AI Analysis Enhanced Styles
  skateabilityScore: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#007bff',
    alignItems: 'center',
    marginBottom: 16,
  },
  skateabilityLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  skateabilityValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#007bff',
    marginBottom: 4,
  },
  confidenceText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  detailedReportSection: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  detailedReportTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1c1c1e',
    marginBottom: 12,
  },
  // Heatmap Toggle Styles
  heatmapToggle: {
    position: 'absolute',
    bottom: 140,
    right: 16,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    backdropFilter: 'blur(20px)',
    transform: [{ scale: 1.02 }],
  },
  // Debug Location Info
  debugLocationInfo: {
    position: 'absolute',
    top: 100,
    left: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  debugLocationText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '600',
  },
  // SnapMap-style pin styles
  snapmapPin: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapmapPinInner: {
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  snapmapPinText: {
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  snapmapPinIcon: {
    textAlign: 'center',
    opacity: 0.9,
  },
  // Cluster-specific styles
  clusterPin: {
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#ff6b35',
    shadowColor: '#ff6b35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterPinInner: {
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff6b35',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  // Cluster content styles
  clusterContent: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  clusterLabel: {
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    opacity: 0.9,
  },
  // Media Gallery Styles
  mediaGallery: {
    height: 250,
    marginBottom: 16,
  },
  mediaItem: {
    width: 350,
    height: 250,
    marginRight: 8,
    position: 'relative',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  mediaVideo: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  mediaOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaTypeLabel: {
    color: '#fff',
    fontSize: 14,
    marginRight: 4,
  },
  mediaDuration: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Media Preview Styles
  mediaPreview: {
    position: 'relative',
    marginRight: 8,
  },
  videoPreview: {
    position: 'relative',
  },
  videoPreviewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  videoPreviewIcon: {
    fontSize: 20,
    color: '#fff',
  },
  removeMediaButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  removeMediaButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  // Video placeholder styles
  videoPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  videoPlaceholderText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
  },
  videoPlaceholderLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  videoPlaceholderSubtext: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  videoPreviewPlaceholder: {
    width: 100,
    height: 100,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  videoPreviewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 4,
  },
});

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
import MapboxGL from '@rnmapbox/maps';
import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { evaluateSpot, reEvaluateSpot } from './lib/ratings';

export default function MapScreen({ user, onLogout }) {
  const [pins, setPins] = useState([]);
  const [center, setCenter] = useState([-96.334407, 30.627977]); // College Station, TX
  const [userLocation, setUserLocation] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [newPinData, setNewPinData] = useState({ name: '', description: '', photos: [] });
  const [currentZoom, setCurrentZoom] = useState(14);
  const [ratingStatus, setRatingStatus] = useState(null); // 'evaluating', 'success', 'pending', 'error'
  const cameraRef = useRef(null);
  const token = Constants?.expoConfig?.extra?.MAPBOX_PUBLIC_TOKEN || Constants?.manifest?.extra?.MAPBOX_PUBLIC_TOKEN;

  useEffect(() => {
    if (token) {
      MapboxGL.setAccessToken(token);
    }
  }, [token]);

  // Fetch skate spots from Supabase
  useEffect(() => {
    fetchSkateSpots();
  }, []);

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
            created_at
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

        // Get photos from spot_media
        const photos = spot.spot_media 
          ? spot.spot_media.filter(media => media.media_type === 'image').map(media => media.media_url)
          : [];

        return {
          id: spot.id,
          name: spot.name,
          description: spot.description,
          coordinates: [spot.longitude, spot.latitude],
          address: spot.address,
          spot_type: spot.spot_type,
          difficulty_level: spot.difficulty_level,
          photos: photos,
          created_at: spot.created_at,
          created_by: spot.created_by,
          latestRating: latestRating
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
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const coords = [pos.coords.longitude, pos.coords.latitude];
          setUserLocation(coords);
          setCenter(coords);
        }
      } catch (err) {
        console.log('Location error:', err);
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
    setNewPinData({ name: '', description: '', photos: [] });
    setShowAddModal(true);
  }, [userLocation]);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera roll permission is needed to add photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setNewPinData(prev => ({
        ...prev,
        photos: [...prev.photos, result.assets[0].uri],
      }));
    }
  };

  const uploadImageToSupabase = async (imageUri, spotId) => {
    try {
      const filename = `${spotId}_${Date.now()}.jpg`;
      console.log('Uploading image:', imageUri, 'as', filename);

      // For testing in simulator, use a real skate park image
      if (imageUri.includes('Library/Caches/ImagePicker')) {
        console.log('Simulator detected - using real skate park image');
        return 'https://drupal-prod.visitcalifornia.com/sites/default/files/styles/fluid_1920/public/VC_Skateparks_MagdalenaEckeYMCA_Supplied_IMG_5676_RT_1280x640.jpg.webp?itok=Q6g-kDMY';
      }

      const file = {
        uri: imageUri,
        type: 'image/jpeg',
        name: filename,
      };

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('spot-media')
        .upload(filename, file, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        console.error('Error uploading image:', uploadError);
        return null;
      }

      console.log('Upload successful:', uploadData);
      const { data: { publicUrl } } = supabase.storage
        .from('spot-media')
        .getPublicUrl(filename);

      console.log('Public URL:', publicUrl);
      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
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

      // Upload images and get URLs
      const uploadedPhotos = [];
      for (const photoUri of newPinData.photos) {
        const imageUrl = await uploadImageToSupabase(photoUri, data.id);
        if (imageUrl) {
          uploadedPhotos.push(imageUrl);
          
          // Save media reference to database
          await supabase
            .from('spot_media')
            .insert({
              spot_id: data.id,
              media_url: imageUrl,
              media_type: 'image',
              uploaded_by: user?.id
            });
        }
      }

      // Transform the saved data to match our pin format
      const newPin = {
        id: data.id,
        coordinates: [data.longitude, data.latitude],
        name: data.name,
        description: data.description,
        photos: uploadedPhotos,
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
      
      // Trigger AI evaluation if we have photos
      if (uploadedPhotos.length > 0) {
        setRatingStatus('evaluating');
        
        const aiResult = await evaluateSpot({
          spotId: data.id,
          imageUrl: uploadedPhotos[0], // Use first photo
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
      setNewPinData({ name: '', description: '', photos: [] });
      setRatingStatus(null);
      
    } catch (error) {
      console.error('Error saving pin:', error);
      Alert.alert('Error', 'Failed to save pin. Please try again.');
      setRatingStatus(null);
    }
  }, [newPinData, userLocation, user]);

  const handleReEvaluate = async (pin) => {
    if (!pin.photos || pin.photos.length === 0) {
      Alert.alert('No Photos', 'This spot needs at least one photo for AI analysis.');
      return;
    }

    try {
      setRatingStatus('evaluating');
      
      const aiResult = await reEvaluateSpot({
        spotId: pin.id,
        imageUrl: pin.photos[0],
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

  return (
    <View style={styles.container}>
      <MapboxGL.MapView 
        style={styles.map} 
        styleURL="mapbox://styles/mapbox/dark-v11"
        onMapIdle={onMapIdle}
      >
        <MapboxGL.Camera ref={cameraRef} zoomLevel={14} centerCoordinate={center} />
        
        {/* User location - rendered first so pins appear on top */}
        {userLocation && (
          <MapboxGL.UserLocation visible={true} showsUserHeadingIndicator={true} />
        )}
        
        {/* Custom image thumbnail pins */}
        {pins.map((pin) => (
          <MapboxGL.MarkerView
            key={pin.id}
            id={String(pin.id)}
            coordinate={pin.coordinates}
            allowOverlap={true}
            allowOverlapWithPuck={true}
            isSelected={false}
          >
            <TouchableOpacity
              onPress={() => {
                setSelectedPin(pin);
                setShowDetailsModal(true);
              }}
              activeOpacity={0.8}
            >
              <View style={styles.markerContainer}>
                {/* Spot name label - now above */}
                <View style={styles.markerLabel}>
                  <Text style={styles.markerLabelText}>
                    {pin.name}
                  </Text>
                </View>
                {pin.photos && pin.photos.length > 0 ? (
                  <>
                    <View style={styles.markerImageContainer}>
                      <Image
                        source={{ uri: pin.photos[0] }}
                        style={styles.markerImage}
                        resizeMode="cover"
                      />
                    </View>
                    <View style={styles.markerPointer} />
                  </>
                ) : (
                  <View style={styles.silhouettePinContainer}>
                    <Image
                      source={defaultPinIcon}
                      style={styles.defaultMarkerIcon}
                      resizeMode="contain"
                    />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </MapboxGL.MarkerView>
        ))}
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
            <Text style={styles.dropdownItemText}>Settings</Text>
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
        <Text style={styles.fabText}>📍</Text>
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

              <Text style={styles.label}>Photos</Text>
              <ScrollView horizontal style={styles.photoScroll}>
                {newPinData.photos.map((uri, idx) => (
                  <Image key={idx} source={{ uri }} style={styles.photoPreview} />
                ))}
                <TouchableOpacity onPress={pickImage} style={styles.addPhotoButton}>
                  <Text style={styles.addPhotoText}>+ Add Photo</Text>
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
              <Text style={styles.modalTitle}>{selectedPin?.name}</Text>
              <TouchableOpacity onPress={() => setShowDetailsModal(false)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {selectedPin?.photos && selectedPin.photos.length > 0 && (
                <ScrollView horizontal pagingEnabled style={styles.photoPager}>
                  {selectedPin.photos.map((uri, idx) => (
                    <Image key={idx} source={{ uri }} style={styles.detailPhoto} />
                  ))}
                </ScrollView>
              )}

              {selectedPin?.description ? (
                <>
                  <Text style={styles.label}>Description</Text>
                  <Text style={styles.descriptionText}>{selectedPin.description}</Text>
                </>
              ) : null}

              {/* AI Rating Section */}
              {selectedPin?.latestRating ? (
                <View style={styles.ratingSection}>
                  <Text style={styles.label}>AI Analysis</Text>
                  
                  {/* Hazard Warning */}
                  {selectedPin.latestRating.hazard_flag && (
                    <View style={styles.hazardWarning}>
                      <Text style={styles.hazardText}>⚠️ HAZARD DETECTED</Text>
                      <Text style={styles.hazardSubtext}>This spot may contain dangerous elements</Text>
                    </View>
                  )}

                  {/* Rating Grid */}
                  <View style={styles.ratingGrid}>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Smoothness</Text>
                      <Text style={styles.ratingValue}>{selectedPin.latestRating.smoothness}/5</Text>
                    </View>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Continuity</Text>
                      <Text style={styles.ratingValue}>{selectedPin.latestRating.continuity}/5</Text>
                    </View>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Debris Risk</Text>
                      <Text style={styles.ratingValue}>{selectedPin.latestRating.debris_risk}/5</Text>
                    </View>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Crack Coverage</Text>
                      <Text style={styles.ratingValue}>{selectedPin.latestRating.crack_coverage}/5</Text>
                    </View>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Night Visibility</Text>
                      <Text style={styles.ratingValue}>{selectedPin.latestRating.night_visibility}/5</Text>
                    </View>
                    <View style={styles.ratingItem}>
                      <Text style={styles.ratingLabel}>Confidence</Text>
                      <Text style={styles.ratingValue}>{Math.round(selectedPin.latestRating.confidence * 100)}%</Text>
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
              ) : (
                <View style={styles.noRatingSection}>
                  <Text style={styles.noRatingText}>No AI analysis available</Text>
                  <Text style={styles.noRatingSubtext}>Add a photo to get AI-powered spot analysis</Text>
                </View>
              )}

              {/* Developer Controls */}
              {__DEV__ && selectedPin?.photos && selectedPin.photos.length > 0 && (
                <View style={styles.devControlsSection}>
                  <Text style={styles.devControlsLabel}>Developer Controls</Text>
                  <TouchableOpacity 
                    onPress={() => handleReEvaluate(selectedPin)} 
                    style={styles.reEvaluateButton}
                    disabled={ratingStatus === 'evaluating'}
                  >
                    <Text style={styles.reEvaluateButtonText}>
                      {ratingStatus === 'evaluating' ? 'Evaluating...' : 'Re-evaluate with AI'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.metaText}>
                Added: {selectedPin?.created_at ? new Date(selectedPin.created_at).toLocaleDateString() : ''}
              </Text>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => setShowDetailsModal(false)} style={styles.closeDetailsButton}>
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
    right: 16,
    zIndex: 1000,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  profileAvatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
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
    top: 112,
    right: 16,
    width: 240,
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 1001,
    overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fafafa',
  },
  dropdownAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  dropdownAvatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  dropdownUserInfo: {
    flex: 1,
  },
  dropdownUserName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1c1c1e',
    marginBottom: 2,
  },
  dropdownUserEmail: {
    fontSize: 12,
    color: '#666',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingVertical: 14,
  },
  dropdownItemIcon: {
    fontSize: 18,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  dropdownItemText: {
    fontSize: 15,
    color: '#1c1c1e',
    fontWeight: '500',
  },
  dropdownItemDanger: {
    backgroundColor: '#fff',
  },
  dropdownItemTextDanger: {
    color: '#ff3b30',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    flexDirection: 'column',
    backgroundColor: 'transparent',
  },
  neonContainer: {
    backgroundColor: 'rgba(10, 10, 15, 0.7)',
    borderRadius: 35,
    borderWidth: 2.5,
    borderColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 4,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 12,
    elevation: 8,
  },
  neonButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  neonButtonText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '300',
    textShadowColor: '#ffffff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  neonDivider: {
    height: 1.5,
    backgroundColor: '#ffffff',
    marginVertical: 8,
    marginHorizontal: 8,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
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
    bottom: 24,
    backgroundColor: 'rgba(10, 10, 15, 0.7)',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ffffff',
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
    textShadowColor: '#ffffff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    fontSize: 28,
    color: '#666',
  },
  modalBody: {
    padding: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    height: 100,
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
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  saveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
  },
  closeDetailsButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // AI Rating Styles
  ratingSection: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
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
    marginTop: 16,
    padding: 16,
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbdefb',
  },
  devControlsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 12,
  },
  reEvaluateButton: {
    backgroundColor: '#1976d2',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  reEvaluateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Custom Marker Styles
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerImageContainer: {
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#fff',
    padding: 1.5,
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  markerImage: {
    width: 50,
    height: 50,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  markerPointer: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
    marginTop: -1,
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
  },
  markerLabel: {
    marginBottom: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    minWidth: 60,
    maxWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  markerLabelText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    flexWrap: 'wrap',
  },
});

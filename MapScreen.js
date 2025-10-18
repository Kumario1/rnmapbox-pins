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

export default function MapScreen({ user, onLogout }) {
  const [pins, setPins] = useState([]);
  const [center, setCenter] = useState([-96.334407, 30.627977]); // College Station, TX
  const [userLocation, setUserLocation] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [newPinData, setNewPinData] = useState({ name: '', description: '', photos: [] });
  const cameraRef = useRef(null);
  const token = Constants?.expoConfig?.extra?.MAPBOX_PUBLIC_TOKEN || Constants?.manifest?.extra?.MAPBOX_PUBLIC_TOKEN;

  useEffect(() => {
    if (token) {
      MapboxGL.setAccessToken(token);
    }
  }, [token]);

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

  const savePin = useCallback(() => {
    if (!newPinData.name.trim()) {
      Alert.alert('Name Required', 'Please enter a name for this pin.');
      return;
    }

    const newPin = {
      id: Date.now().toString(),
      coordinates: userLocation,
      name: newPinData.name,
      description: newPinData.description,
      photos: newPinData.photos,
      createdAt: new Date().toISOString(),
    };

    setPins(prev => [...prev, newPin]);
    setShowAddModal(false);
  }, [newPinData, userLocation]);

  const geojson = {
    type: 'FeatureCollection',
    features: pins.map(pin => ({
      type: 'Feature',
      id: pin.id,
      properties: { id: pin.id, name: pin.name },
      geometry: {
        type: 'Point',
        coordinates: pin.coordinates,
      },
    })),
  };

  const redPinIcon = require('./assets/better-pin.png');

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
        
        <MapboxGL.Images images={{ redPin: redPinIcon }} />
        
        {/* Pins with dynamic zoom-based sizing and enhanced styling */}
        <MapboxGL.ShapeSource id="pins" shape={geojson} onPress={onPinPress}>
          {/* Icon glow layer (rendered first for halo effect) */}
          <MapboxGL.CircleLayer
            id="pinGlow"
            style={{
              circleRadius: [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                10, 12,
                14, 18,
                18, 28
              ],
              circleColor: '#ff3b30',
              circleOpacity: 0.2,
              circleBlur: 1,
            }}
          />
          
          {/* Main pin icon */}
          <MapboxGL.SymbolLayer
            id="pinLayer"
            style={{
              iconImage: 'redPin',
              iconSize: [
                'interpolate',
                ['exponential', 1.5],
                ['zoom'],
                10, 0.28,
                12, 0.38,
                14, 0.5,
                16, 0.65,
                18, 0.85,
                20, 1.1
              ],
              iconAllowOverlap: true,
              iconAnchor: 'bottom',
              iconPitchAlignment: 'viewport',
              iconRotationAlignment: 'viewport',
              iconOpacity: 0.95,
              symbolZOrder: 'source',
              textField: ['get', 'name'],
              textSize: [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 11,
                14, 16,
                18, 22
              ],
              textOffset: [0, -3.8],
              textColor: '#ffffff',
              textHaloColor: '#000000',
              textHaloWidth: 2.5,
              textHaloBlur: 0.5,
              textAllowOverlap: false,
              textOptional: true,
              textFont: ['Open Sans Bold', 'Arial Unicode MS Bold'],
            }}
          />
        </MapboxGL.ShapeSource>
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

      <TouchableOpacity onPress={openAddPinModal} style={styles.fab} activeOpacity={0.8}>
        <Text style={styles.fabText}>+</Text>
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

              <Text style={styles.metaText}>
                Added: {selectedPin?.createdAt ? new Date(selectedPin.createdAt).toLocaleDateString() : ''}
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
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    backgroundColor: '#1c1c1e',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
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
});

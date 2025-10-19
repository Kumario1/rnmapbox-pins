import * as Location from 'expo-location';
import { supabase } from '../supabase';

class LocationService {
  constructor() {
    this.isTracking = false;
    this.trackingInterval = null;
    this.currentLocation = null;
    this.userId = null;
    this.updateInterval = 10000; // 10 seconds
    this.accuracy = Location.Accuracy.Balanced;
  }

  /**
   * Initialize location tracking for a user
   * @param {string} userId - The user's ID
   * @param {Object} options - Tracking options
   */
  async initialize(userId, options = {}) {
    try {
      this.userId = userId;
      this.updateInterval = options.updateInterval || 10000;
      this.accuracy = options.accuracy || Location.Accuracy.Balanced;

      // Request permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Location permission not granted');
      }

      // Request background permissions for continuous tracking
      const backgroundStatus = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus.status !== 'granted') {
        console.warn('Background location permission not granted - tracking will be limited');
      }

      console.log('Location service initialized for user:', userId);
      return true;
    } catch (error) {
      console.error('Failed to initialize location service:', error);
      return false;
    }
  }

  /**
   * Start tracking user location
   */
  async startTracking() {
    if (this.isTracking) {
      console.log('Location tracking already active');
      return;
    }

    if (!this.userId) {
      throw new Error('Location service not initialized');
    }

    try {
      this.isTracking = true;
      
      // Get initial location
      await this.updateLocation();
      
      // Set up interval for continuous updates
      this.trackingInterval = setInterval(async () => {
        await this.updateLocation();
      }, this.updateInterval);

      console.log('Location tracking started');
    } catch (error) {
      console.error('Failed to start location tracking:', error);
      this.isTracking = false;
      throw error;
    }
  }

  /**
   * Stop tracking user location
   */
  stopTracking() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    
    this.isTracking = false;
    console.log('Location tracking stopped');
  }

  /**
   * Update user location and sync with database
   */
  async updateLocation() {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: this.accuracy,
        timeInterval: 5000, // 5 seconds timeout
      });

      const { latitude, longitude, accuracy, heading, speed } = location.coords;
      
      this.currentLocation = {
        latitude,
        longitude,
        accuracy,
        heading,
        speed,
        timestamp: new Date().toISOString()
      };

      // Update presence in database
      await this.updateUserPresence({
        latitude,
        longitude,
        accuracy,
        heading,
        speed
      });

      return this.currentLocation;
    } catch (error) {
      console.error('Failed to update location:', error);
      throw error;
    }
  }

  /**
   * Update user presence in the database
   */
  async updateUserPresence(locationData) {
    try {
      const { data, error } = await supabase
        .from('user_presence')
        .upsert({
          user_id: this.userId,
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
          heading: locationData.heading,
          speed: locationData.speed,
          is_active: true,
          last_seen: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('Failed to update user presence:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating user presence:', error);
      return false;
    }
  }

  /**
   * Get users near a specific location
   * @param {number} latitude - Target latitude
   * @param {number} longitude - Target longitude
   * @param {number} radiusMeters - Search radius in meters
   */
  async getUsersNearLocation(latitude, longitude, radiusMeters = 50) {
    try {
      const { data, error } = await supabase.rpc('get_users_near_spot', {
        spot_lat: latitude,
        spot_lng: longitude,
        radius_meters: radiusMeters
      });

      if (error) {
        console.error('Failed to get users near location:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting users near location:', error);
      return [];
    }
  }

  /**
   * Get current user location
   */
  getCurrentLocation() {
    return this.currentLocation;
  }

  /**
   * Check if tracking is active
   */
  isTrackingActive() {
    return this.isTracking;
  }

  /**
   * Calculate distance between two coordinates
   * @param {number} lat1 - First latitude
   * @param {number} lng1 - First longitude
   * @param {number} lat2 - Second latitude
   * @param {number} lng2 - Second longitude
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stopTracking();
    this.userId = null;
    this.currentLocation = null;
  }
}

// Export singleton instance
export default new LocationService();

import { supabase } from '../supabase';

class HeatmapService {
  constructor() {
    this.heatmapData = [];
    this.spotTrafficData = new Map();
    this.updateInterval = null;
    this.isActive = false;
  }

  /**
   * Initialize heatmap service
   */
  async initialize() {
    try {
      console.log('Heatmap service initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize heatmap service:', error);
      return false;
    }
  }

  /**
   * Start real-time heatmap updates
   * @param {Array} skateSpots - Array of skate spots
   * @param {Function} onUpdate - Callback for heatmap updates
   */
  async startRealTimeUpdates(skateSpots, onUpdate) {
    if (this.isActive) {
      console.log('Heatmap updates already active');
      return;
    }

    this.isActive = true;
    this.skateSpots = skateSpots;
    this.onUpdate = onUpdate;

    // Initial update
    await this.updateHeatmapData();

    // Set up real-time updates every 5 seconds
    this.updateInterval = setInterval(async () => {
      await this.updateHeatmapData();
    }, 5000);

    console.log('Real-time heatmap updates started');
  }

  /**
   * Stop real-time heatmap updates
   */
  stopRealTimeUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.isActive = false;
    console.log('Real-time heatmap updates stopped');
  }

  /**
   * Update heatmap data by checking user presence near skate spots
   */
  async updateHeatmapData() {
    try {
      if (!this.skateSpots || this.skateSpots.length === 0) {
        return;
      }

      const updatedSpots = [];
      
      // Check each skate spot for nearby users
      for (const spot of this.skateSpots) {
        const nearbyUsers = await this.getUsersNearSpot(spot);
        const trafficLevel = this.calculateTrafficLevel(nearbyUsers.length);
        
        // Update spot traffic data
        this.spotTrafficData.set(spot.id, {
          spotId: spot.id,
          currentUsers: nearbyUsers.length,
          trafficLevel,
          nearbyUsers,
          lastUpdated: new Date().toISOString()
        });

        // Update the spot object
        const updatedSpot = {
          ...spot,
          current_users: nearbyUsers.length,
          traffic_level: trafficLevel,
          last_updated: new Date().toISOString()
        };

        updatedSpots.push(updatedSpot);
      }

      // Update heatmap data
      this.heatmapData = this.generateHeatmapData(updatedSpots);

      // Notify callback
      if (this.onUpdate) {
        this.onUpdate({
          spots: updatedSpots,
          heatmapData: this.heatmapData,
          spotTrafficData: Array.from(this.spotTrafficData.values())
        });
      }

      console.log(`Heatmap updated: ${updatedSpots.length} spots processed`);
    } catch (error) {
      console.error('Failed to update heatmap data:', error);
    }
  }

  /**
   * Get users near a specific skate spot
   * @param {Object} spot - Skate spot object
   * @param {number} radiusMeters - Search radius in meters (default 50)
   */
  async getUsersNearSpot(spot, radiusMeters = 50) {
    try {
      const { data, error } = await supabase.rpc('get_users_near_spot', {
        spot_lat: spot.coordinates[1], // latitude
        spot_lng: spot.coordinates[0], // longitude
        radius_meters: radiusMeters
      });

      if (error) {
        console.error('Failed to get users near spot:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting users near spot:', error);
      return [];
    }
  }

  /**
   * Calculate traffic level based on user count
   * @param {number} userCount - Number of users
   */
  calculateTrafficLevel(userCount) {
    if (userCount === 0) return 0;
    if (userCount <= 2) return 1;
    if (userCount <= 5) return 2;
    if (userCount <= 10) return 3;
    if (userCount <= 20) return 4;
    return 5;
  }

  /**
   * Generate heatmap data for Mapbox visualization
   * @param {Array} spots - Array of updated skate spots
   */
  generateHeatmapData(spots) {
    return spots
      .filter(spot => (spot.current_users || 0) > 0) // Only include spots with users
      .map(spot => ({
        type: 'Feature',
        properties: {
          id: spot.id,
          name: spot.name,
          current_users: spot.current_users || 0,
          traffic_level: spot.traffic_level || 0,
          intensity: this.getHeatmapIntensity(spot.traffic_level || 0)
        },
        geometry: {
          type: 'Point',
          coordinates: spot.coordinates
        }
      }));
  }

  /**
   * Get heatmap intensity value (0-1) based on traffic level
   * @param {number} trafficLevel - Traffic level (0-5)
   */
  getHeatmapIntensity(trafficLevel) {
    return Math.min(1, trafficLevel / 5);
  }

  /**
   * Get traffic color based on traffic level
   * @param {number} trafficLevel - Traffic level (0-5)
   */
  getTrafficColor(trafficLevel) {
    switch (trafficLevel) {
      case 0: return '#22c55e'; // Green - No traffic
      case 1: return '#84cc16'; // Light green - Low traffic
      case 2: return '#eab308'; // Yellow - Medium traffic
      case 3: return '#f97316'; // Orange - High traffic
      case 4: return '#ef4444'; // Red - Very high traffic
      case 5: return '#dc2626'; // Dark red - Maximum traffic
      default: return '#6b7280'; // Gray - Unknown
    }
  }

  /**
   * Get traffic description based on traffic level
   * @param {number} trafficLevel - Traffic level (0-5)
   * @param {number} userCount - Number of users
   */
  getTrafficDescription(trafficLevel, userCount) {
    const descriptions = {
      0: 'No activity',
      1: 'Light activity',
      2: 'Moderate activity',
      3: 'Busy',
      4: 'Very busy',
      5: 'Crowded'
    };

    const baseDescription = descriptions[trafficLevel] || 'Unknown';
    return `${baseDescription} (${userCount} user${userCount !== 1 ? 's' : ''})`;
  }

  /**
   * Get current heatmap data
   */
  getHeatmapData() {
    return this.heatmapData;
  }

  /**
   * Get current spot traffic data
   */
  getSpotTrafficData() {
    return Array.from(this.spotTrafficData.values());
  }

  /**
   * Get traffic data for a specific spot
   * @param {string} spotId - Spot ID
   */
  getSpotTrafficData(spotId) {
    return this.spotTrafficData.get(spotId);
  }

  /**
   * Update skate spots list
   * @param {Array} spots - New skate spots array
   */
  updateSkateSpots(spots) {
    this.skateSpots = spots;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stopRealTimeUpdates();
    this.heatmapData = [];
    this.spotTrafficData.clear();
    this.skateSpots = null;
    this.onUpdate = null;
  }
}

// Export singleton instance
export default new HeatmapService();

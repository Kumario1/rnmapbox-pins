# Live Heatmap Feature Documentation

## Overview

The Live Heatmap feature provides real-time visualization of user activity at skate spots. It tracks user locations, detects when users are within proximity of skate spots, and updates both the map visualization and traffic panels with live data.

## Features

### 🔥 Real-time Heatmap Visualization
- **Dynamic heatmap layer** on the map showing user activity intensity
- **Color-coded intensity** from blue (no activity) to red (high activity)
- **Toggle button** to show/hide the heatmap
- **Real-time updates** every 5 seconds

### 📍 Live User Tracking
- **Background location tracking** with configurable accuracy
- **Proximity detection** within 50-meter radius of skate spots
- **Automatic cleanup** of stale location data
- **Privacy-focused** - users only see their own location data

### 📊 Enhanced Traffic Panels
- **Live user count** at each skate spot
- **Traffic level indicators** (0-5 scale)
- **Last updated timestamps** for transparency
- **Real-time status** in profile menu

## Technical Implementation

### Database Schema

#### User Presence Table
```sql
CREATE TABLE user_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    accuracy NUMERIC(8, 2),
    heading NUMERIC(5, 2),
    speed NUMERIC(8, 2),
    is_active BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Key Functions
- `get_users_near_spot()` - Find users within radius of a spot
- `cleanup_old_presence()` - Remove stale location data
- **Row Level Security** - Users can only access their own data

### Services Architecture

#### LocationService (`lib/locationService.js`)
- **Singleton pattern** for global state management
- **Background location tracking** with configurable intervals
- **Automatic database synchronization**
- **Distance calculations** using Haversine formula
- **Error handling** and permission management

#### HeatmapService (`lib/heatmapService.js`)
- **Real-time data processing** and aggregation
- **Traffic level calculations** based on user count
- **Heatmap data generation** for Mapbox visualization
- **Callback system** for UI updates
- **Automatic cleanup** and resource management

### Map Integration

#### Heatmap Layer
```javascript
<MapboxGL.HeatmapLayer
  id="heatmap-layer"
  sourceID="heatmap-source"
  style={{
    heatmapWeight: { type: 'exponential', stops: [[0, 0], [1, 1]] },
    heatmapIntensity: { stops: [[0, 0], [1, 1]] },
    heatmapColor: [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0, 0, 255, 0)',      // No activity
      0.1, 'rgb(0, 255, 255)',     // Low activity
      0.3, 'rgb(0, 255, 0)',       // Medium activity
      0.5, 'rgb(255, 255, 0)',     // High activity
      0.7, 'rgb(255, 165, 0)',     // Very high activity
      1, 'rgb(255, 0, 0)'          // Maximum activity
    ],
    heatmapRadius: { stops: [[0, 2], [1, 20]] },
    heatmapOpacity: 0.6
  }}
/>
```

## Usage

### For Users

1. **Enable Location Tracking**
   - Location tracking starts automatically when you log in
   - Grant location permissions when prompted
   - Your location is tracked in the background

2. **View Live Heatmap**
   - Tap the 🔥 button to toggle heatmap visibility
   - Heatmap shows real-time activity at skate spots
   - Colors indicate activity intensity

3. **Check Traffic Status**
   - Tap your profile avatar
   - Select "Live Traffic Status" to see current activity
   - View detailed traffic info in spot modals

### For Developers

#### Initialization
```javascript
// Initialize location service
await locationService.initialize(userId, {
  updateInterval: 10000, // 10 seconds
  accuracy: Location.Accuracy.Balanced
});

// Start tracking
await locationService.startTracking();

// Initialize heatmap service
await heatmapService.initialize();

// Start real-time updates
await heatmapService.startRealTimeUpdates(skateSpots, (updateData) => {
  // Handle updates
  setHeatmapData(updateData.heatmapData);
  setLiveTrafficData(updateData.spotTrafficData);
});
```

#### Customization
```javascript
// Adjust tracking frequency
locationService.updateInterval = 5000; // 5 seconds

// Change proximity radius
const nearbyUsers = await heatmapService.getUsersNearSpot(spot, 100); // 100 meters

// Custom traffic level calculation
const trafficLevel = heatmapService.calculateTrafficLevel(userCount);
```

## Privacy & Security

### Data Protection
- **User isolation** - Users can only see their own location data
- **Automatic cleanup** - Old location data is automatically removed
- **No persistent storage** - Location data is not stored locally
- **Encrypted transmission** - All data is transmitted over HTTPS

### Permissions
- **Foreground location** - Required for basic functionality
- **Background location** - Optional for continuous tracking
- **User consent** - Clear permission requests with explanations

## Performance Considerations

### Optimization Strategies
- **Efficient queries** - Indexed database queries for fast lookups
- **Batch updates** - Location updates are batched to reduce database load
- **Automatic cleanup** - Stale data is removed to maintain performance
- **Configurable intervals** - Adjustable update frequencies

### Resource Management
- **Memory cleanup** - Services properly clean up resources
- **Battery optimization** - Balanced accuracy for battery life
- **Network efficiency** - Minimal data transmission

## Troubleshooting

### Common Issues

1. **Location not updating**
   - Check location permissions
   - Verify background app refresh is enabled
   - Check device location services

2. **Heatmap not showing**
   - Ensure heatmap toggle is enabled
   - Check if users are within proximity of spots
   - Verify database connection

3. **Traffic data not updating**
   - Check network connection
   - Verify Supabase configuration
   - Check console for errors

### Debug Information
- **Console logs** - Detailed logging for debugging
- **Status indicators** - UI shows tracking status
- **Error handling** - Graceful error recovery

## Future Enhancements

### Planned Features
- **Historical data** - Track activity patterns over time
- **Push notifications** - Alert users when spots become active
- **Social features** - See friends' locations (with permission)
- **Analytics dashboard** - Detailed activity statistics
- **Custom radius** - User-configurable proximity detection

### Technical Improvements
- **WebSocket integration** - Real-time updates without polling
- **Offline support** - Cache data for offline viewing
- **Advanced analytics** - Machine learning for activity prediction
- **Performance monitoring** - Real-time performance metrics

## API Reference

### LocationService Methods
- `initialize(userId, options)` - Initialize the service
- `startTracking()` - Begin location tracking
- `stopTracking()` - Stop location tracking
- `updateLocation()` - Manually update location
- `getCurrentLocation()` - Get current location
- `calculateDistance(lat1, lng1, lat2, lng2)` - Calculate distance

### HeatmapService Methods
- `initialize()` - Initialize the service
- `startRealTimeUpdates(spots, callback)` - Start real-time updates
- `stopRealTimeUpdates()` - Stop real-time updates
- `getUsersNearSpot(spot, radius)` - Get users near a spot
- `calculateTrafficLevel(userCount)` - Calculate traffic level
- `getHeatmapData()` - Get current heatmap data

## Database Functions

### SQL Functions
- `get_users_near_spot(spot_lat, spot_lng, radius_meters)` - Find nearby users
- `cleanup_old_presence()` - Clean up stale data
- `update_user_presence_updated_at()` - Update timestamp trigger

This comprehensive heatmap feature transforms the skate spot app into a real-time social platform, allowing users to see live activity and make informed decisions about where to skate based on current conditions.

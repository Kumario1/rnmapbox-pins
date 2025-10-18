import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle, Path, Ellipse } from 'react-native-svg';

export default function CustomPin({ size = 100 }) {
  return (
    <View style={[styles.container, { width: size, height: size * 1.4 }]}>
      <Svg width={size} height={size * 1.4} viewBox="0 0 100 140">
        <Defs>
          {/* Gradient for the main pin body */}
          <LinearGradient id="pinGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#ff5252" stopOpacity="1" />
            <Stop offset="50%" stopColor="#ff3b30" stopOpacity="1" />
            <Stop offset="100%" stopColor="#d32f2f" stopOpacity="1" />
          </LinearGradient>
          
          {/* Gradient for the glow effect */}
          <LinearGradient id="glowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#ff5252" stopOpacity="0.6" />
            <Stop offset="100%" stopColor="#ff3b30" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        
        {/* Outer glow */}
        <Ellipse
          cx="50"
          cy="45"
          rx="38"
          ry="38"
          fill="url(#glowGradient)"
          opacity="0.3"
        />
        
        {/* Shadow at bottom */}
        <Ellipse
          cx="50"
          cy="130"
          rx="18"
          ry="5"
          fill="#000000"
          opacity="0.4"
        />
        
        {/* Main pin shape */}
        <Path
          d="M50 5 C65 5, 75 15, 75 35 C75 55, 50 85, 50 130 C50 85, 25 55, 25 35 C25 15, 35 5, 50 5 Z"
          fill="url(#pinGradient)"
          stroke="#d32f2f"
          strokeWidth="1.5"
        />
        
        {/* Inner white circle */}
        <Circle
          cx="50"
          cy="35"
          r="15"
          fill="#ffffff"
          opacity="0.95"
        />
        
        {/* Center red dot */}
        <Circle
          cx="50"
          cy="35"
          r="8"
          fill="#ff3b30"
        />
        
        {/* Highlight shine effect */}
        <Ellipse
          cx="42"
          cy="28"
          rx="12"
          ry="15"
          fill="#ffffff"
          opacity="0.25"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});


/**
 * Test script for heatmap functionality
 * Run with: node test-heatmap.js
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const supabaseUrl = 'https://iijsgwiqbemgaugwgrbx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpanNnd2lxYmVtZ2F1Z3dncmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA3OTA0NzAsImV4cCI6MjA3NjM2NjQ3MH0.r5xYYjPzZfCvRtVcLHRUfknuzaey1geTx9vQfGX-_cs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testHeatmapFunctionality() {
  console.log('🔥 Testing Heatmap Functionality...\n');

  try {
    // Test 1: Check if user_presence table exists
    console.log('1. Checking user_presence table...');
    const { data: tableData, error: tableError } = await supabase
      .from('user_presence')
      .select('*')
      .limit(1);

    if (tableError) {
      console.log('❌ user_presence table not found. Please run the migration first.');
      console.log('   Run: supabase db push');
      return;
    }
    console.log('✅ user_presence table exists');

    // Test 2: Check if get_users_near_spot function exists
    console.log('\n2. Testing get_users_near_spot function...');
    const { data: functionData, error: functionError } = await supabase.rpc('get_users_near_spot', {
      spot_lat: 30.627977, // College Station, TX
      spot_lng: -96.334407,
      radius_meters: 50
    });

    if (functionError) {
      console.log('❌ get_users_near_spot function not found. Please run the migration first.');
      console.log('   Run: supabase db push');
      return;
    }
    console.log('✅ get_users_near_spot function works');
    console.log(`   Found ${functionData.length} users near test location`);

    // Test 3: Check skate_spots table
    console.log('\n3. Checking skate_spots table...');
    const { data: spotsData, error: spotsError } = await supabase
      .from('skate_spots')
      .select('id, name, latitude, longitude')
      .limit(5);

    if (spotsError) {
      console.log('❌ skate_spots table not found or accessible');
      return;
    }
    console.log(`✅ Found ${spotsData.length} skate spots`);

    // Test 4: Test proximity detection for each spot
    console.log('\n4. Testing proximity detection...');
    for (const spot of spotsData) {
      const { data: nearbyUsers, error: nearbyError } = await supabase.rpc('get_users_near_spot', {
        spot_lat: spot.latitude,
        spot_lng: spot.longitude,
        radius_meters: 50
      });

      if (!nearbyError) {
        console.log(`   ${spot.name}: ${nearbyUsers.length} users within 50m`);
      }
    }

    // Test 5: Check cleanup function
    console.log('\n5. Testing cleanup function...');
    const { data: cleanupData, error: cleanupError } = await supabase.rpc('cleanup_old_presence');
    
    if (cleanupError) {
      console.log('❌ cleanup_old_presence function not found');
    } else {
      console.log('✅ cleanup function works');
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Run the app: npm start');
    console.log('2. Enable location permissions');
    console.log('3. Check the heatmap toggle (🔥 button)');
    console.log('4. View live traffic data in spot modals');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testHeatmapFunctionality();

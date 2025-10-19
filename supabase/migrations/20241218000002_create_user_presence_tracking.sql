-- Create user_presence table for real-time user location tracking
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_presence_user_id ON user_presence(user_id);

-- Create index on location for proximity queries
CREATE INDEX IF NOT EXISTS idx_user_presence_location ON user_presence(latitude, longitude);

-- Create index on last_seen for cleanup queries
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON user_presence(last_seen);

-- Create index on is_active for active user queries
CREATE INDEX IF NOT EXISTS idx_user_presence_is_active ON user_presence(is_active);

-- Enable RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see their own presence data
CREATE POLICY "Users can view own presence" ON user_presence
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own presence data
CREATE POLICY "Users can insert own presence" ON user_presence
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own presence data
CREATE POLICY "Users can update own presence" ON user_presence
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own presence data
CREATE POLICY "Users can delete own presence" ON user_presence
    FOR DELETE USING (auth.uid() = user_id);

-- Service role can read all presence data for analytics
CREATE POLICY "Service role can read all presence" ON user_presence
    FOR SELECT USING (auth.role() = 'service_role');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_presence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_user_presence_updated_at
    BEFORE UPDATE ON user_presence
    FOR EACH ROW
    EXECUTE FUNCTION update_user_presence_updated_at();

-- Create function to clean up old presence data (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_old_presence()
RETURNS void AS $$
BEGIN
    UPDATE user_presence 
    SET is_active = FALSE 
    WHERE last_seen < NOW() - INTERVAL '5 minutes' 
    AND is_active = TRUE;
    
    DELETE FROM user_presence 
    WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Create function to get users near a spot
CREATE OR REPLACE FUNCTION get_users_near_spot(
    spot_lat NUMERIC,
    spot_lng NUMERIC,
    radius_meters NUMERIC DEFAULT 50
)
RETURNS TABLE (
    user_id UUID,
    latitude NUMERIC,
    longitude NUMERIC,
    distance_meters NUMERIC,
    last_seen TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.user_id,
        up.latitude,
        up.longitude,
        -- Calculate distance using Haversine formula (approximate)
        (6371000 * acos(
            cos(radians(spot_lat)) * 
            cos(radians(up.latitude)) * 
            cos(radians(up.longitude) - radians(spot_lng)) + 
            sin(radians(spot_lat)) * 
            sin(radians(up.latitude))
        ))::NUMERIC AS distance_meters,
        up.last_seen
    FROM user_presence up
    WHERE up.is_active = TRUE
    AND up.last_seen > NOW() - INTERVAL '5 minutes'
    AND (
        6371000 * acos(
            cos(radians(spot_lat)) * 
            cos(radians(up.latitude)) * 
            cos(radians(up.longitude) - radians(spot_lng)) + 
            sin(radians(spot_lat)) * 
            sin(radians(up.latitude))
        )
    ) <= radius_meters
    ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

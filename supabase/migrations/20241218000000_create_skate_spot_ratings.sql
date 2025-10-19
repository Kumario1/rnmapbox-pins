-- Create skate_spot_ratings table for AI-powered spot evaluation
CREATE TABLE IF NOT EXISTS skate_spot_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spot_id UUID NOT NULL REFERENCES skate_spots(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES auth.users(id),
    smoothness NUMERIC(3,1) CHECK (smoothness >= 0 AND smoothness <= 5),
    continuity NUMERIC(3,1) CHECK (continuity >= 0 AND continuity <= 5),
    debris_risk NUMERIC(3,1) CHECK (debris_risk >= 0 AND debris_risk <= 5),
    crack_coverage NUMERIC(3,1) CHECK (crack_coverage >= 0 AND crack_coverage <= 5),
    night_visibility NUMERIC(3,1) CHECK (night_visibility >= 0 AND night_visibility <= 5),
    hazard_flag BOOLEAN DEFAULT FALSE,
    confidence NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on spot_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_skate_spot_ratings_spot_id ON skate_spot_ratings(spot_id);

-- Create index on created_at for ordering
CREATE INDEX IF NOT EXISTS idx_skate_spot_ratings_created_at ON skate_spot_ratings(created_at DESC);

-- Enable RLS
ALTER TABLE skate_spot_ratings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow authenticated users to read ratings
CREATE POLICY "Authenticated users can read ratings" ON skate_spot_ratings
    FOR SELECT USING (auth.role() = 'authenticated');

-- Only allow service role to insert ratings (for Edge Function)
CREATE POLICY "Service role can insert ratings" ON skate_spot_ratings
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Allow service role to update ratings
CREATE POLICY "Service role can update ratings" ON skate_spot_ratings
    FOR UPDATE USING (auth.role() = 'service_role');

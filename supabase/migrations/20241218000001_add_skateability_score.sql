-- Add skateability_score column to skate_spot_ratings table
ALTER TABLE skate_spot_ratings 
ADD COLUMN skateability_score NUMERIC(3,1) CHECK (skateability_score >= 0 AND skateability_score <= 5);

-- Add comment to explain the new column
COMMENT ON COLUMN skate_spot_ratings.skateability_score IS 'Overall skateability score based on detected skateable features like stairs, rails, ledges, etc.';

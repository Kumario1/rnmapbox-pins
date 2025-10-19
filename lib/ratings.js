import { supabase } from '../supabase';

/**
 * Evaluates a skate spot using AI vision analysis
 * @param {Object} params - Evaluation parameters
 * @param {string} params.spotId - The skate spot ID
 * @param {string} params.imageUrl - URL of the image to analyze
 * @param {string} params.userId - ID of the user who uploaded the image
 * @returns {Promise<Object>} - Result object with rating data or pending status
 */
export const evaluateSpot = async ({ spotId, imageUrl, userId }) => {
  try {
    console.log('Starting AI evaluation for spot:', spotId, 'with image:', imageUrl);
    
    const result = await supabase.functions.invoke('evaluate-spot', {
      body: { 
        spotId, 
        mediaUrl: imageUrl, 
        userId 
      }
    });

    console.log('Full Supabase function invoke result:', result);
    console.log('Result data:', result.data);
    console.log('Result error:', result.error);

    const { data, error } = result;

    if (error) {
      console.error('Error calling AI evaluation function:', error);
      console.error('Error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return { 
        success: false, 
        error: error.message || 'Failed to evaluate spot',
        type: 'error'
      };
    }

    console.log('AI evaluation response:', data);

    // Handle different response types
    if (data.pending) {
      return {
        success: true,
        pending: true,
        reason: data.reason || 'AI analysis is pending review',
        type: 'pending'
      };
    }

    if (data.rating) {
      return {
        success: true,
        rating: data.rating,
        type: 'success'
      };
    }

    // Fallback for unexpected response format
    return {
      success: false,
      error: 'Unexpected response format from AI service',
      type: 'error'
    };

  } catch (error) {
    console.error('Failed to evaluate spot with AI:', error);
    return { 
      success: false, 
      error: error.message || 'Network error during evaluation',
      type: 'error'
    };
  }
};

/**
 * Re-triggers AI evaluation for an existing spot
 * @param {string} spotId - The skate spot ID
 * @param {string} imageUrl - URL of the image to analyze
 * @param {string} userId - ID of the user requesting re-evaluation
 * @returns {Promise<Object>} - Result object with rating data or pending status
 */
export const reEvaluateSpot = async ({ spotId, imageUrl, userId }) => {
  console.log('Re-evaluating spot:', spotId);
  return evaluateSpot({ spotId, imageUrl, userId });
};

/**
 * Gets the latest rating for a specific spot
 * @param {string} spotId - The skate spot ID
 * @returns {Promise<Object|null>} - Latest rating or null if none exists
 */
export const getLatestRating = async (spotId) => {
  try {
    const { data, error } = await supabase
      .from('skate_spot_ratings')
      .select('*')
      .eq('spot_id', spotId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching latest rating:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Failed to fetch latest rating:', error);
    return null;
  }
};
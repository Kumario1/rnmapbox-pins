import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    const body = await req.text();
    console.log('Request body:', body);
    const { spotId, mediaUrl, userId } = JSON.parse(body);
    if (!spotId) {
      return new Response(JSON.stringify({
        error: 'Missing required field: spotId'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://iijsgwiqbemgaugwgrbx.supabase.co';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Get Google Cloud Vision API key
    const visionApiKey = Deno.env.get('GCLOUD_VISION_API_KEY');
    if (!visionApiKey) {
      throw new Error('GCLOUD_VISION_API_KEY not configured');
    }
    // If no mediaUrl provided or invalid, fetch from database
    let finalMediaUrl = mediaUrl;
    if (!mediaUrl || !mediaUrl.includes('supabase.co/storage/v1/object/public/')) {
      console.log('No valid mediaUrl provided, fetching from database for spotId:', spotId);
      const { data: mediaData, error: mediaError } = await supabase.from('spot_media').select('media_url').eq('spot_id', spotId).eq('media_type', 'image').order('created_at', {
        ascending: false
      }).limit(1).single();
      if (mediaError || !mediaData) {
        console.log('No media found in database for spotId:', spotId);
        return new Response(JSON.stringify({
          error: 'No image found for this spot',
          details: 'No media_url found in spot_media table'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      finalMediaUrl = mediaData.media_url;
      console.log('Found media URL in database:', finalMediaUrl);
    }
    // Download and encode image with FIXED processing
    let imageBase64;
    try {
      const imageResponse = await fetch(finalMediaUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'SkateSpotEvaluator/1.0'
        },
        // Add timeout
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
      }
      const contentType = imageResponse.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL does not point to an image');
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      // Check file size (Google Vision API has limits)
      if (imageBuffer.byteLength > 20 * 1024 * 1024) {
        throw new Error('Image too large (max 20MB)');
      }
      if (imageBuffer.byteLength === 0) {
        throw new Error('Empty image file');
      }
      // FIXED: Process image buffer in chunks to avoid call stack overflow
      const uint8Array = new Uint8Array(imageBuffer);
      const chunkSize = 8192 // Process in 8KB chunks
      ;
      let binaryString = '';
      for(let i = 0; i < uint8Array.length; i += chunkSize){
        const chunk = uint8Array.slice(i, i + chunkSize);
        binaryString += String.fromCharCode(...chunk);
      }
      imageBase64 = btoa(binaryString);
    } catch (error) {
      console.error('Error downloading image:', error);
      return new Response(JSON.stringify({
        error: 'Failed to download image',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Call Google Cloud Vision API with optimized features for skateboarding spot analysis
    const visionRequest = {
      requests: [
        {
          image: {
            content: imageBase64
          },
          features: [
            {
              type: 'LABEL_DETECTION',
              maxResults: 20
            },
            {
              type: 'IMAGE_PROPERTIES',
              maxResults: 1
            },
            {
              type: 'SAFE_SEARCH_DETECTION',
              maxResults: 1
            },
            {
              type: 'OBJECT_LOCALIZATION',
              maxResults: 15
            },
            {
              type: 'TEXT_DETECTION',
              maxResults: 5
            } // For signs, warnings, etc.
          ],
          imageContext: {
            // Add context hints for better detection
            languageHints: [
              'en'
            ],
            textDetectionParams: {
              enableTextDetectionConfidenceScore: true
            }
          }
        }
      ]
    };
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(visionRequest)
    });
    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Vision API error:', visionResponse.status, errorText);
      return new Response(JSON.stringify({
        error: 'Vision API request failed'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const visionData = await visionResponse.json();
    const response = visionData.responses[0];
    if (!response) {
      return new Response(JSON.stringify({
        error: 'No response from Vision API'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check for Vision API errors
    if (response.error) {
      console.error('Vision API error:', response.error);
      return new Response(JSON.stringify({
        error: 'Vision API error',
        details: response.error.message,
        code: response.error.code
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Convert Vision response to rubric values
    const evaluation = convertVisionToRubric(response);
    // Clamp values to valid ranges
    const clamp = (value, min, max)=>Math.max(min, Math.min(max, value));
    const clampedEvaluation = {
      smoothness: clamp(evaluation.smoothness, 0, 5),
      continuity: clamp(evaluation.continuity, 0, 5),
      debris_risk: clamp(evaluation.debris_risk, 0, 5),
      crack_coverage: clamp(evaluation.crack_coverage, 0, 5),
      night_visibility: clamp(evaluation.night_visibility, 0, 5),
      hazard_flag: Boolean(evaluation.hazard_flag),
      confidence: clamp(evaluation.confidence, 0, 1),
      notes: evaluation.notes || '',
      skateability_score: clamp(evaluation.skateability_score, 0, 5)
    };
    // Check confidence threshold
    if (clampedEvaluation.confidence < 0.3) {
      return new Response(JSON.stringify({
        pending: true,
        reason: 'Low confidence in AI analysis'
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Insert rating into database using service role
    const insertData = {
      spot_id: spotId,
      uploaded_by: userId || null,
      smoothness: clampedEvaluation.smoothness,
      continuity: clampedEvaluation.continuity,
      debris_risk: clampedEvaluation.debris_risk,
      crack_coverage: clampedEvaluation.crack_coverage,
      night_visibility: clampedEvaluation.night_visibility,
      hazard_flag: clampedEvaluation.hazard_flag,
      confidence: clampedEvaluation.confidence,
      notes: clampedEvaluation.notes,
      skateability_score: clampedEvaluation.skateability_score
    };
    console.log('Inserting rating with data:', insertData);
    const { data, error } = await supabase.from('skate_spot_ratings').insert(insertData).select().single();
    if (error) {
      console.error('Database error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return new Response(JSON.stringify({
        error: 'Failed to save rating to database',
        details: error.message,
        code: error.code
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      rating: data,
      skateability_score: clampedEvaluation.skateability_score,
      success: true
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function convertVisionToRubric(response) {
  const labels = response.labelAnnotations || [];
  const objects = response.localObjectAnnotations || [];
  const texts = response.textAnnotations || [];
  const imageProps = response.imagePropertiesAnnotation;
  const safeSearch = response.safeSearchAnnotation;
  // Enhanced keyword mapping for skateboarding spot evaluation
  // Focus on skateability rather than just skateparks
  const smoothnessKeywords = {
    positive: [
      'smooth',
      'polished',
      'clean',
      'flat',
      'concrete',
      'asphalt',
      'pavement',
      'marble',
      'granite',
      'brick',
      'tile'
    ],
    negative: [
      'rough',
      'bumpy',
      'uneven',
      'cracked',
      'damaged',
      'weathered',
      'pothole',
      'gravel',
      'dirt',
      'grass',
      'mud'
    ]
  };
  const continuityKeywords = {
    positive: [
      'continuous',
      'unbroken',
      'seamless',
      'flat',
      'pavement',
      'concrete',
      'asphalt',
      'plaza',
      'square',
      'courtyard'
    ],
    negative: [
      'disconnected',
      'broken',
      'fragmented',
      'interrupted',
      'grass',
      'dirt',
      'gravel',
      'mud',
      'water'
    ]
  };
  const debrisKeywords = [
    'debris',
    'dirt',
    'gravel',
    'sand',
    'trash',
    'litter',
    'leaves',
    'rocks',
    'sticks',
    'glass',
    'bottle',
    'mud',
    'water'
  ];
  const crackKeywords = [
    'crack',
    'fracture',
    'damage',
    'broken',
    'weathered',
    'old',
    'chipped',
    'pothole',
    'hole'
  ];
  // Skateable features - these are POSITIVE for skateboarding!
  const skateableFeatures = [
    'stairs',
    'step',
    'ledge',
    'rail',
    'handrail',
    'curb',
    'drop',
    'gap',
    'bank',
    'transition',
    'ramp',
    'bowl',
    'quarter pipe',
    'half pipe'
  ];
  // Actual hazards that make skating dangerous
  const hazardKeywords = [
    'traffic',
    'car',
    'vehicle',
    'bus',
    'truck',
    'bicycle',
    'pedestrian',
    'crowd',
    'spike',
    'broken glass',
    'sharp metal',
    'exposed rebar',
    'electrical',
    'wire'
  ];
  // Text-based hazard detection (signs, warnings, etc.)
  const warningTexts = [
    'no skateboarding',
    'private property',
    'danger',
    'warning',
    'keep out',
    'trespassing',
    'closed'
  ];
  const hasWarningText = texts.some((text)=>warningTexts.some((warning)=>text.description.toLowerCase().includes(warning)));
  // Calculate scores with improved algorithm
  const smoothness = calculateEnhancedScore(labels, objects, smoothnessKeywords, true);
  const continuity = calculateEnhancedScore(labels, objects, continuityKeywords, true);
  const debris_risk = calculateScore(labels, debrisKeywords, false);
  const crack_coverage = calculateScore(labels, crackKeywords, false);
  // Calculate skateability score based on skateable features
  const skateabilityScore = calculateSkateabilityScore(labels, objects, skateableFeatures);
  // Calculate night visibility from image brightness with better algorithm
  let night_visibility = 2.5 // Default medium
  ;
  if (imageProps?.dominantColors?.colors && imageProps.dominantColors.colors.length > 0) {
    const totalScore = imageProps.dominantColors.colors.reduce((sum, color)=>sum + color.score, 0);
    const weightedBrightness = imageProps.dominantColors.colors.reduce((sum, color)=>{
      const brightness = (color.color.red + color.color.green + color.color.blue) / 3;
      return sum + brightness * (color.score / totalScore);
    }, 0);
    // Convert brightness (0-255) to visibility score (0-5) with better scaling
    night_visibility = Math.min(5, Math.max(0, weightedBrightness / 255 * 5));
  }
  // Enhanced hazard detection including text warnings
  const hazard_flag = checkForHazards(labels, objects, hazardKeywords) || hasWarningText;
  // Calculate overall confidence with better weighting including text detection
  const confidences = [
    ...labels.map((l)=>l.score),
    ...objects.map((o)=>o.score),
    ...texts.map((t)=>t.score || 0.5) // Text detection confidence
  ];
  const confidence = confidences.length > 0 ? Math.min(1, Math.max(0, confidences.reduce((sum, c)=>sum + c, 0) / confidences.length)) : 0.3 // Lower default confidence if no detections
  ;
  // Generate enhanced notes including text detection
  const notes = generateEnhancedNotes(labels, objects, texts, safeSearch, smoothness, continuity, debris_risk, crack_coverage, hasWarningText);
  return {
    // FIXED: Use full precision from AI - no rounding!
    smoothness: smoothness,
    continuity: continuity,
    debris_risk: debris_risk,
    crack_coverage: crack_coverage,
    night_visibility: night_visibility,
    hazard_flag,
    confidence: confidence,
    notes,
    skateability_score: skateabilityScore
  };
}
function calculateSkateabilityScore(labels, objects, skateableFeatures) {
  // Find all skateable features detected
  const detectedFeatures = [];
  // Check labels for skateable features
  labels.forEach((label)=>{
    skateableFeatures.forEach((feature)=>{
      if (label.description.toLowerCase().includes(feature)) {
        detectedFeatures.push({
          type: 'label',
          feature,
          score: label.score
        });
      }
    });
  });
  // Check objects for skateable features
  objects.forEach((obj)=>{
    skateableFeatures.forEach((feature)=>{
      if (obj.name.toLowerCase().includes(feature)) {
        detectedFeatures.push({
          type: 'object',
          feature,
          score: obj.score
        });
      }
    });
  });
  if (detectedFeatures.length === 0) {
    return 2.0 // Default low-medium score for areas without obvious skateable features
    ;
  }
  // Calculate weighted score based on feature types and confidence
  let totalScore = 0;
  let weightSum = 0;
  detectedFeatures.forEach((detection)=>{
    let weight = 1.0;
    // Weight different features differently
    if (detection.feature.includes('rail') || detection.feature.includes('handrail')) {
      weight = 1.5 // Rails are highly skateable
      ;
    } else if (detection.feature.includes('stairs') || detection.feature.includes('step')) {
      weight = 1.3 // Stairs are very skateable
      ;
    } else if (detection.feature.includes('ledge') || detection.feature.includes('curb')) {
      weight = 1.2 // Ledges and curbs are skateable
      ;
    } else if (detection.feature.includes('drop') || detection.feature.includes('gap')) {
      weight = 1.4 // Drops and gaps are exciting features
      ;
    } else if (detection.feature.includes('ramp') || detection.feature.includes('bowl')) {
      weight = 1.6 // Dedicated skate features get highest weight
      ;
    }
    totalScore += detection.score * weight;
    weightSum += weight;
  });
  const averageScore = totalScore / weightSum;
  const skateabilityScore = Math.min(5, averageScore * 5) // Convert to 0-5 scale
  ;
  return Math.max(1.0, skateabilityScore) // Minimum score of 1.0 if features are detected
  ;
}
function calculateEnhancedScore(labels, objects, keywords, higherIsBetter) {
  // Calculate positive and negative scores
  const positiveLabels = labels.filter((label)=>keywords.positive.some((keyword)=>label.description.toLowerCase().includes(keyword)));
  const negativeLabels = labels.filter((label)=>keywords.negative.some((keyword)=>label.description.toLowerCase().includes(keyword)));
  const positiveObjects = objects.filter((obj)=>keywords.positive.some((keyword)=>obj.name.toLowerCase().includes(keyword)));
  const negativeObjects = objects.filter((obj)=>keywords.negative.some((keyword)=>obj.name.toLowerCase().includes(keyword)));
  // Calculate weighted scores
  const positiveScore = [
    ...positiveLabels,
    ...positiveObjects
  ].reduce((sum, item)=>sum + item.score, 0) / Math.max(1, positiveLabels.length + positiveObjects.length);
  const negativeScore = [
    ...negativeLabels,
    ...negativeObjects
  ].reduce((sum, item)=>sum + item.score, 0) / Math.max(1, negativeLabels.length + negativeObjects.length);
  // Combine scores
  let finalScore = 2.5 // Default medium
  ;
  if (positiveScore > 0 || negativeScore > 0) {
    const positiveWeight = positiveScore * 5;
    const negativeWeight = negativeScore * 5;
    if (higherIsBetter) {
      finalScore = Math.min(5, 2.5 + positiveWeight - negativeWeight);
    } else {
      finalScore = Math.max(0, 2.5 - positiveWeight + negativeWeight);
    }
  }
  return Math.max(0, Math.min(5, finalScore));
}
function calculateScore(labels, keywords, higherIsBetter) {
  const relevantLabels = labels.filter((label)=>keywords.some((keyword)=>label.description.toLowerCase().includes(keyword)));
  if (relevantLabels.length === 0) {
    return 2.5 // Default medium score
    ;
  }
  const avgScore = relevantLabels.reduce((sum, label)=>sum + label.score, 0) / relevantLabels.length;
  const rubricScore = avgScore * 5;
  return higherIsBetter ? rubricScore : 5 - rubricScore;
}
function checkForHazards(labels, objects, hazardKeywords) {
  const labelHazards = labels.some((label)=>hazardKeywords.some((keyword)=>label.description.toLowerCase().includes(keyword)));
  const objectHazards = objects.some((obj)=>hazardKeywords.some((keyword)=>obj.name.toLowerCase().includes(keyword)));
  return labelHazards || objectHazards;
}
function generateEnhancedNotes(labels, objects, texts, safeSearch, smoothness, continuity, debris_risk, crack_coverage, hasWarningText) {
  const notes = [];
  // Add skateable features analysis
  const skateableFeatures = [
    'stairs',
    'step',
    'ledge',
    'rail',
    'handrail',
    'curb',
    'drop',
    'gap',
    'bank',
    'transition',
    'ramp',
    'bowl',
    'quarter pipe',
    'half pipe'
  ];
  const detectedSkateableFeatures = [];
  labels.forEach((label)=>{
    skateableFeatures.forEach((feature)=>{
      if (label.description.toLowerCase().includes(feature)) {
        detectedSkateableFeatures.push(feature);
      }
    });
  });
  objects.forEach((obj)=>{
    skateableFeatures.forEach((feature)=>{
      if (obj.name.toLowerCase().includes(feature)) {
        detectedSkateableFeatures.push(feature);
      }
    });
  });
  if (detectedSkateableFeatures.length > 0) {
    const uniqueFeatures = [
      ...new Set(detectedSkateableFeatures)
    ];
    notes.push(`Skateable features: ${uniqueFeatures.join(', ')}`);
  }
  // Add warning text detection
  if (hasWarningText) {
    notes.push('Warning signs detected - check local regulations');
  }
  // Add quality assessments
  if (smoothness >= 4.0) {
    notes.push('High smoothness detected');
  } else if (smoothness <= 2.0) {
    notes.push('Low smoothness - rough surface');
  }
  if (continuity >= 4.0) {
    notes.push('Good flow/continuity');
  } else if (continuity <= 2.0) {
    notes.push('Poor continuity - fragmented surface');
  }
  if (debris_risk >= 4.0) {
    notes.push('High debris risk detected');
  }
  if (crack_coverage >= 4.0) {
    notes.push('Significant cracking/damage');
  }
  // Add detected objects and labels
  if (labels.length > 0) {
    const topLabels = labels.slice(0, 5).map((l)=>l.description).join(', ');
    notes.push(`Detected: ${topLabels}`);
  }
  if (objects.length > 0) {
    const topObjects = objects.slice(0, 5).map((o)=>o.name).join(', ');
    notes.push(`Objects: ${topObjects}`);
  }
  // Add detected text (signs, warnings, etc.)
  if (texts.length > 0) {
    const topTexts = texts.slice(0, 3).map((t)=>t.description).join(', ');
    notes.push(`Text detected: ${topTexts}`);
  }
  // Add safety concerns
  if (safeSearch) {
    const safetyIssues = [];
    if (safeSearch.adult === 'LIKELY' || safeSearch.adult === 'VERY_LIKELY') safetyIssues.push('adult content');
    if (safeSearch.violence === 'LIKELY' || safeSearch.violence === 'VERY_LIKELY') safetyIssues.push('violence');
    if (safeSearch.racy === 'LIKELY' || safeSearch.racy === 'VERY_LIKELY') safetyIssues.push('racy content');
    if (safetyIssues.length > 0) {
      notes.push(`Safety concerns: ${safetyIssues.join(', ')}`);
    }
  }
  return notes.join('; ');
}
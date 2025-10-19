import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://iijsgwiqbemgaugwgrbx.supabase.co';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseServiceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const visionApiKey = Deno.env.get('GCLOUD_VISION_API_KEY');
    if (!visionApiKey) {
      throw new Error('GCLOUD_VISION_API_KEY not configured');
    }
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
        signal: AbortSignal.timeout(30000)
      });
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
      }
      const contentType = imageResponse.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new Error('URL does not point to an image');
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      if (imageBuffer.byteLength > 20 * 1024 * 1024) {
        throw new Error('Image too large (max 20MB)');
      }
      if (imageBuffer.byteLength === 0) {
        throw new Error('Empty image file');
      }
      // FIXED: Process image buffer in chunks to avoid call stack overflow
      const uint8Array = new Uint8Array(imageBuffer);
      const chunkSize = 8192;
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
    // Call Google Cloud Vision API
    const visionRequest = {
      requests: [
        {
          image: {
            content: imageBase64
          },
          features: [
            {
              type: 'LABEL_DETECTION',
              maxResults: 40
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
              maxResults: 25
            },
            {
              type: 'TEXT_DETECTION',
              maxResults: 10
            }
          ],
          imageContext: {
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
    // CLEAN TAMU SKATE SPOT ANALYSIS
    const evaluation = analyzeSkateSpot(response);
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
    if (clampedEvaluation.confidence < 0.25) {
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
    // Upsert rating into database (update existing or insert new)
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
    console.log('Upserting rating with data:', insertData);
    const { data, error } = await supabase
      .from('skate_spot_ratings')
      .upsert(insertData, { 
        onConflict: 'spot_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();
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
function analyzeSkateSpot(response) {
  const labels = response.labelAnnotations || [];
  const objects = response.localObjectAnnotations || [];
  const texts = response.textAnnotations || [];
  const imageProps = response.imagePropertiesAnnotation;
  const safeSearch = response.safeSearchAnnotation;
  console.log('=== TAMU SKATE SPOT ANALYSIS ===');
  console.log('Labels:', labels.map((l)=>`${l.description} (${(l.score * 100).toFixed(1)}%)`));
  console.log('Objects:', objects.map((o)=>`${o.name} (${(o.score * 100).toFixed(1)}%)`));
  // 1. SKATEABILITY SCORE (Most Important - TAMU skaters want stairs, ledges, drops)
  const skateability_score = calculateSkateabilityScore(labels, objects);
  // 2. SURFACE QUALITY (Smoothness)
  const smoothness = calculateSurfaceQuality(labels, objects);
  // 3. FLOW & CONTINUITY 
  const continuity = calculateContinuity(labels, objects);
  // 4. DEBRIS & MAINTENANCE
  const debris_risk = calculateDebrisRisk(labels, objects);
  // 5. STRUCTURAL INTEGRITY (Crack Coverage)
  const crack_coverage = calculateCrackCoverage(labels, objects);
  // 6. NIGHT VISIBILITY (Minimal impact)
  const night_visibility = calculateNightVisibility(imageProps, labels);
  // 7. HAZARD DETECTION (Only real dangers)
  const hazard_flag = detectRealHazards(labels, objects, texts, safeSearch);
  // 8. CONFIDENCE
  const confidence = calculateConfidence(labels, objects, texts);
  // 9. PROFESSIONAL NOTES
  const notes = generateNotes(labels, objects, smoothness, continuity, debris_risk, crack_coverage, skateability_score, night_visibility, hazard_flag);
  return {
    smoothness: parseFloat(smoothness.toFixed(1)),
    continuity: parseFloat(continuity.toFixed(1)),
    debris_risk: parseFloat(debris_risk.toFixed(1)),
    crack_coverage: parseFloat(crack_coverage.toFixed(1)),
    night_visibility: parseFloat(night_visibility.toFixed(1)),
    hazard_flag,
    confidence: parseFloat(confidence.toFixed(1)),
    notes,
    skateability_score: parseFloat(skateability_score.toFixed(1))
  };
}
function calculateSkateabilityScore(labels, objects) {
  // TAMU PRIORITY FEATURES - Clean, focused detection
  const tamuFeatures = {
    // TAMU GOLD STANDARD - Stairs
    'stairs': {
      score: 4.9,
      keywords: [
        'stairs',
        'steps',
        'stairway',
        'staircase',
        'stair set',
        'step',
        'stair'
      ],
      weight: 2.5
    },
    // TAMU GOLD STANDARD - Ledges
    'ledges': {
      score: 4.7,
      keywords: [
        'ledge',
        'curb',
        'edge',
        'border',
        'rim',
        'lip',
        'platform',
        'retaining wall'
      ],
      weight: 2.2
    },
    // TAMU GOLD STANDARD - Drops
    'drops': {
      score: 4.8,
      keywords: [
        'drop',
        'gap',
        'space',
        'opening',
        'void',
        'clearance',
        'jump',
        'leap',
        'height difference',
        'level change'
      ],
      weight: 2.3
    },
    // Rails
    'rails': {
      score: 4.5,
      keywords: [
        'rail',
        'handrail',
        'railing',
        'barrier',
        'guardrail',
        'fence'
      ],
      weight: 1.8
    },
    // Dedicated skate features
    'skatepark': {
      score: 4.9,
      keywords: [
        'skatepark',
        'skate park',
        'skateboarding',
        'skateboard',
        'skating'
      ],
      weight: 2.5
    },
    'half pipe': {
      score: 5.0,
      keywords: [
        'half pipe',
        'halfpipe',
        'half-pipe'
      ],
      weight: 2.0
    },
    'bowl': {
      score: 4.9,
      keywords: [
        'bowl',
        'pool',
        'skate bowl',
        'skate pool'
      ],
      weight: 2.0
    },
    'quarter pipe': {
      score: 4.8,
      keywords: [
        'quarter pipe',
        'quarterpipe',
        'quarter-pipe'
      ],
      weight: 1.8
    },
    'ramp': {
      score: 4.6,
      keywords: [
        'ramp',
        'skate ramp',
        'launch ramp'
      ],
      weight: 1.6
    },
    // Urban features
    'plaza': {
      score: 3.8,
      keywords: [
        'plaza',
        'square',
        'courtyard',
        'open space',
        'public space'
      ],
      weight: 1.2
    },
    'parking': {
      score: 3.5,
      keywords: [
        'parking lot',
        'parking',
        'lot',
        'car park'
      ],
      weight: 1.0
    },
    'sidewalk': {
      score: 3.2,
      keywords: [
        'sidewalk',
        'walkway',
        'path',
        'pathway'
      ],
      weight: 0.9
    }
  };
  let totalScore = 0;
  let totalWeight = 0;
  let detectedFeatures = [];
  let tamuFeatureCount = 0;
  const allDetections = [
    ...labels,
    ...objects
  ];
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    for (const [feature, data] of Object.entries(tamuFeatures)){
      if (data.keywords.some((keyword)=>text.includes(keyword)) && confidence > 0.25) {
        const featureScore = data.score * data.weight * confidence;
        totalScore += featureScore;
        totalWeight += data.weight * confidence;
        detectedFeatures.push({
          name: feature,
          confidence,
          score: data.score
        });
        // Count TAMU priority features
        if ([
          'stairs',
          'ledges',
          'drops',
          'rails'
        ].includes(feature)) {
          tamuFeatureCount++;
        }
      }
    }
  });
  // LOGICAL REASONING
  const isSkatepark = labels.some((l)=>(l.description.toLowerCase().includes('skatepark') || l.description.toLowerCase().includes('skate park') || l.description.toLowerCase().includes('skateboarding')) && l.score > 0.7);
  if (isSkatepark) {
    console.log('LOGICAL REASONING: Detected skatepark - automatically high skateability');
    return 4.8;
  }
  // TAMU FEATURE BONUS: If we detect multiple TAMU priority features, boost the score
  if (tamuFeatureCount >= 2) {
    console.log(`LOGICAL REASONING: Detected ${tamuFeatureCount} TAMU priority features - applying bonus`);
    const bonus = Math.min(0.5, tamuFeatureCount * 0.2) // Up to 0.5 bonus
    ;
    if (totalWeight > 0) {
      const baseScore = totalScore / totalWeight;
      return Math.max(1.5, Math.min(5, baseScore + bonus));
    }
  }
  // Calculate final score
  if (totalWeight > 0) {
    const finalScore = totalScore / totalWeight;
    console.log('LOGICAL REASONING: Detected features:', detectedFeatures.map((f)=>`${f.name} (${(f.confidence * 100).toFixed(0)}%)`));
    return Math.max(1.5, Math.min(5, finalScore));
  }
  // Default scoring for open areas
  const hasOpenSpace = labels.some((l)=>(l.description.toLowerCase().includes('plaza') || l.description.toLowerCase().includes('courtyard')) && l.score > 0.6);
  return hasOpenSpace ? 3.5 : 2.5;
}
function calculateSurfaceQuality(labels, objects) {
  const surfaceTypes = {
    'concrete': {
      score: 3.8,
      keywords: [
        'concrete',
        'cement',
        'pavement'
      ]
    },
    'asphalt': {
      score: 3.5,
      keywords: [
        'asphalt',
        'blacktop',
        'road surface'
      ]
    },
    'brick': {
      score: 3.2,
      keywords: [
        'brick',
        'brickwork',
        'masonry'
      ]
    },
    'marble': {
      score: 4.5,
      keywords: [
        'marble',
        'granite',
        'stone'
      ]
    },
    'tile': {
      score: 4.0,
      keywords: [
        'tile',
        'ceramic',
        'porcelain'
      ]
    },
    'wood': {
      score: 3.0,
      keywords: [
        'wood',
        'wooden',
        'deck'
      ]
    },
    'metal': {
      score: 3.8,
      keywords: [
        'metal',
        'steel',
        'aluminum'
      ]
    }
  };
  let totalScore = 0;
  let totalWeight = 0;
  const allDetections = [
    ...labels,
    ...objects
  ];
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    for (const [surfaceType, data] of Object.entries(surfaceTypes)){
      if (data.keywords.some((keyword)=>text.includes(keyword)) && confidence > 0.4) {
        totalScore += data.score * confidence;
        totalWeight += confidence;
      }
    }
  });
  const qualityIndicators = {
    excellent: {
      keywords: [
        'smooth',
        'polished',
        'clean',
        'new'
      ],
      boost: 1.4
    },
    good: {
      keywords: [
        'flat',
        'level',
        'even'
      ],
      boost: 1.2
    },
    poor: {
      keywords: [
        'rough',
        'bumpy',
        'uneven'
      ],
      penalty: 0.8
    },
    terrible: {
      keywords: [
        'cracked',
        'broken',
        'damaged'
      ],
      penalty: 0.6
    }
  };
  let qualityMultiplier = 1.0;
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    for (const [quality, data] of Object.entries(qualityIndicators)){
      if (data.keywords.some((keyword)=>text.includes(keyword)) && confidence > 0.5) {
        if (data.boost) {
          qualityMultiplier *= 1 + (data.boost - 1) * confidence;
        } else if (data.penalty) {
          qualityMultiplier *= data.penalty + (1 - data.penalty) * (1 - confidence);
        }
      }
    }
  });
  if (totalWeight > 0) {
    return Math.max(0, Math.min(5, totalScore / totalWeight * qualityMultiplier));
  }
  const hasGoodArea = labels.some((l)=>(l.description.toLowerCase().includes('plaza') || l.description.toLowerCase().includes('courtyard')) && l.score > 0.6);
  return hasGoodArea ? 3.5 : 3.0;
}
function calculateContinuity(labels, objects) {
  const flowIndicators = {
    excellent: {
      keywords: [
        'plaza',
        'courtyard',
        'open space',
        'square'
      ],
      score: 4.2
    },
    good: {
      keywords: [
        'pavement',
        'sidewalk',
        'pathway'
      ],
      score: 3.5
    },
    poor: {
      keywords: [
        'fragmented',
        'broken',
        'interrupted'
      ],
      score: 2.0
    },
    terrible: {
      keywords: [
        'grass',
        'dirt',
        'gravel'
      ],
      score: 1.2
    }
  };
  let totalScore = 0;
  let totalWeight = 0;
  const allDetections = [
    ...labels,
    ...objects
  ];
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    for (const [flowType, data] of Object.entries(flowIndicators)){
      if (data.keywords.some((keyword)=>text.includes(keyword)) && confidence > 0.4) {
        totalScore += data.score * confidence;
        totalWeight += confidence;
      }
    }
  });
  if (totalWeight > 0) {
    return Math.max(0, Math.min(5, totalScore / totalWeight));
  }
  const hasOpenSpace = labels.some((l)=>(l.description.toLowerCase().includes('plaza') || l.description.toLowerCase().includes('courtyard')) && l.score > 0.6);
  return hasOpenSpace ? 3.8 : 3.0;
}
function calculateDebrisRisk(labels, objects) {
  const debrisKeywords = [
    'debris',
    'trash',
    'litter',
    'leaves',
    'dirt',
    'gravel',
    'sand',
    'rocks',
    'glass',
    'bottle'
  ];
  let debrisScore = 0;
  let totalConfidence = 0;
  const allDetections = [
    ...labels,
    ...objects
  ];
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    if (debrisKeywords.some((keyword)=>text.includes(keyword)) && confidence > 0.4) {
      debrisScore += confidence * 3.5;
      totalConfidence += confidence;
    }
  });
  if (totalConfidence > 0) {
    return Math.min(5, debrisScore / totalConfidence);
  }
  const hasCleanArea = labels.some((l)=>(l.description.toLowerCase().includes('plaza') || l.description.toLowerCase().includes('courtyard')) && l.score > 0.6);
  return hasCleanArea ? 1.0 : 1.5;
}
function calculateCrackCoverage(labels, objects) {
  const crackKeywords = [
    'crack',
    'fracture',
    'damage',
    'broken',
    'weathered',
    'pothole',
    'hole'
  ];
  let crackScore = 0;
  let totalConfidence = 0;
  const allDetections = [
    ...labels,
    ...objects
  ];
  allDetections.forEach((detection)=>{
    const text = (detection.description || detection.name || '').toLowerCase();
    const confidence = detection.score;
    if (crackKeywords.some((keyword)=>text.includes(keyword)) && confidence > 0.4) {
      crackScore += confidence * 4.0;
      totalConfidence += confidence;
    }
  });
  if (totalConfidence > 0) {
    return Math.min(5, crackScore / totalConfidence);
  }
  const hasGoodSurface = labels.some((l)=>(l.description.toLowerCase().includes('concrete') || l.description.toLowerCase().includes('smooth')) && l.score > 0.6);
  return hasGoodSurface ? 0.5 : 1.0;
}
function calculateNightVisibility(imageProps, labels) {
  let baseScore = 3.0;
  if (imageProps?.dominantColors?.colors && imageProps.dominantColors.colors.length > 0) {
    const totalScore = imageProps.dominantColors.colors.reduce((sum, color)=>sum + color.score, 0);
    const weightedBrightness = imageProps.dominantColors.colors.reduce((sum, color)=>{
      const brightness = (color.color.red + color.color.green + color.color.blue) / 3;
      return sum + brightness * (color.score / totalScore);
    }, 0);
    baseScore = Math.min(5, Math.max(0, weightedBrightness / 255 * 5));
  }
  const hasDaylight = labels.some((l)=>(l.description.toLowerCase().includes('daylight') || l.description.toLowerCase().includes('sunny')) && l.score > 0.6);
  if (hasDaylight) {
    baseScore = Math.max(baseScore, 4.5);
  }
  return baseScore;
}
function detectRealHazards(labels, objects, texts, safeSearch) {
  const warningTexts = [
    'no skateboarding',
    'private property',
    'danger',
    'warning',
    'keep out',
    'trespassing',
    'closed',
    'no skating'
  ];
  const hasWarningText = texts.some((text)=>warningTexts.some((warning)=>text.description.toLowerCase().includes(warning)));
  if (hasWarningText) return true;
  const dangerousObjects = [
    'broken glass',
    'sharp metal',
    'exposed rebar',
    'electrical wire',
    'construction'
  ];
  const hasDangerousObjects = labels.some((label)=>dangerousObjects.some((danger)=>label.description.toLowerCase().includes(danger) && label.score > 0.6));
  if (hasDangerousObjects) return true;
  if (safeSearch && (safeSearch.violence === 'LIKELY' || safeSearch.violence === 'VERY_LIKELY')) {
    return true;
  }
  return false;
}
function calculateConfidence(labels, objects, texts) {
  const allDetections = [
    ...labels,
    ...objects,
    ...texts
  ];
  if (allDetections.length === 0) return 0.2;
  const avgConfidence = allDetections.reduce((sum, detection)=>sum + (detection.score || 0.5), 0) / allDetections.length;
  const highConfidenceDetections = allDetections.filter((d)=>d.score > 0.7).length;
  const confidenceBoost = Math.min(0.2, highConfidenceDetections * 0.05);
  return Math.min(1, Math.max(0.1, avgConfidence + confidenceBoost));
}
function generateNotes(labels, objects, smoothness, continuity, debris_risk, crack_coverage, skateability_score, night_visibility, hazard_flag) {
  const notes = [];
  const isSkatepark = labels.some((l)=>(l.description.toLowerCase().includes('skatepark') || l.description.toLowerCase().includes('skate park') || l.description.toLowerCase().includes('skateboarding')) && l.score > 0.7);
  if (isSkatepark) {
    notes.push(`Dedicated skateboarding facility detected (${skateability_score.toFixed(2)}/5) - This is a purpose-built skateboarding area with professional-grade features`);
  } else {
    const tamuFeatures = [
      'stairs',
      'ledge',
      'drop',
      'rail',
      'handrail',
      'curb',
      'gap'
    ];
    const detectedTamuFeatures = [];
    const tamuFeatureDetails = [];
    const allDetections = [
      ...labels,
      ...objects
    ];
    allDetections.forEach((detection)=>{
      const text = (detection.description || detection.name || '').toLowerCase();
      const confidence = detection.score;
      tamuFeatures.forEach((feature)=>{
        if (text.includes(feature) && confidence > 0.25) {
          detectedTamuFeatures.push(feature);
          tamuFeatureDetails.push(`${feature} (${(confidence * 100).toFixed(0)}%)`);
        }
      });
    });
    if (detectedTamuFeatures.length > 0) {
      const uniqueFeatures = [
        ...new Set(detectedTamuFeatures)
      ];
      const featureDetails = [
        ...new Set(tamuFeatureDetails)
      ];
      notes.push(`High-priority skateboarding features detected (${skateability_score.toFixed(2)}/5): ${uniqueFeatures.join(', ')} - These elements are highly valued by local skaters. Detection details: ${featureDetails.join(', ')}`);
    } else if (skateability_score >= 4.0) {
      notes.push(`Excellent skateboarding potential (${skateability_score.toFixed(2)}/5) - Multiple skateable features present`);
    } else if (skateability_score >= 3.5) {
      notes.push(`Good skateboarding potential (${skateability_score.toFixed(2)}/5) - Solid skateable features available`);
    } else if (skateability_score >= 3.0) {
      notes.push(`Moderate skateboarding potential (${skateability_score.toFixed(2)}/5) - Some skateable elements present`);
    } else if (skateability_score >= 2.0) {
      notes.push(`Limited skateboarding potential (${skateability_score.toFixed(2)}/5) - Few skateable features detected`);
    } else {
      notes.push(`Minimal skateboarding potential (${skateability_score.toFixed(2)}/5) - Limited skateable elements`);
    }
  }
  if (smoothness >= 4.0) {
    notes.push(`Premium surface quality (${smoothness.toFixed(2)}/5) - Excellent surface conditions for skateboarding`);
  } else if (smoothness >= 3.5) {
    notes.push(`Good surface quality (${smoothness.toFixed(2)}/5) - Suitable surface conditions for skateboarding`);
  } else if (smoothness >= 3.0) {
    notes.push(`Adequate surface quality (${smoothness.toFixed(2)}/5) - Acceptable surface conditions`);
  } else if (smoothness <= 2.5) {
    notes.push(`Poor surface quality (${smoothness.toFixed(2)}/5) - Rough or damaged surface conditions`);
  }
  if (continuity >= 4.0) {
    notes.push(`Excellent flow and continuity (${continuity.toFixed(2)}/5) - Continuous skating surface with good flow`);
  } else if (continuity >= 3.5) {
    notes.push(`Good flow and continuity (${continuity.toFixed(2)}/5) - Solid skating surface with decent flow`);
  } else if (continuity >= 3.0) {
    notes.push(`Adequate flow and continuity (${continuity.toFixed(2)}/5) - Acceptable skating surface`);
  } else if (continuity <= 2.5) {
    notes.push(`Poor flow and continuity (${continuity.toFixed(2)}/5) - Fragmented or interrupted surface`);
  }
  if (hazard_flag) {
    notes.push(`Safety concerns detected - Review area for warning signs or hazardous conditions before skating`);
  } else {
    notes.push(`No significant safety hazards detected - Area appears safe for skateboarding`);
  }
  if (debris_risk >= 4.0) {
    notes.push(`High debris risk (${debris_risk.toFixed(2)}/5) - Surface may contain obstacles or debris`);
  } else if (debris_risk <= 1.5) {
    notes.push(`Clean surface conditions (${debris_risk.toFixed(2)}/5) - Low debris risk, well-maintained area`);
  } else {
    notes.push(`Moderate debris risk (${debris_risk.toFixed(2)}/5) - Some debris may be present`);
  }
  if (crack_coverage >= 4.0) {
    notes.push(`Significant surface damage (${crack_coverage.toFixed(2)}/5) - Visible cracks or structural damage`);
  } else if (crack_coverage <= 1.0) {
    notes.push(`Well-maintained surface (${crack_coverage.toFixed(2)}/5) - Minimal surface damage`);
  } else {
    notes.push(`Moderate surface damage (${crack_coverage.toFixed(2)}/5) - Some surface wear present`);
  }
  if (night_visibility >= 4.0) {
    notes.push(`Good visibility conditions (${night_visibility.toFixed(2)}/5) - Adequate lighting for skateboarding`);
  } else if (night_visibility <= 2.5) {
    notes.push(`Limited visibility conditions (${night_visibility.toFixed(2)}/5) - Poor lighting may affect night skating`);
  }
  if (labels.length > 0) {
    const topLabels = labels.slice(0, 5).map((l)=>`${l.description} (${(l.score * 100).toFixed(0)}%)`).join(', ');
    notes.push(`AI analysis detected: ${topLabels}`);
  }
  if (objects.length > 0) {
    const topObjects = objects.slice(0, 5).map((o)=>`${o.name} (${(o.score * 100).toFixed(0)}%)`).join(', ');
    notes.push(`Objects identified: ${topObjects}`);
  }
  return notes.join('; ');
}

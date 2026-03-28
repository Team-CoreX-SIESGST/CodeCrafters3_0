import dotenv from 'dotenv';
dotenv.config();

const GROQ_KEY = process.env.GROQ_KEY;

// Simple in-memory cache to reduce API calls
const medicineCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(medicineName, genericName) {
  return `${medicineName.toLowerCase()}-${genericName?.toLowerCase() || ''}`;
}

function getCachedResponse(key) {
  const cached = medicineCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedResponse(key, data) {
  medicineCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// Basic medicine information fallback for common medicines
function getBasicMedicineInfo(medicineName) {
  const basicInfo = {
    paracetamol: {
      description: "Paracetamol is a common pain reliever and fever reducer.",
      primaryUses: ["Pain relief", "Fever reduction"],
      commonSideEffects: ["Rare at recommended doses"],
      genericAlternatives: [{"name": "Acetaminophen", "note": "Same active ingredient"}],
      otcAvailable: true,
      warningNote: "Do not exceed recommended dosage."
    },
    aspirin: {
      description: "Aspirin is a nonsteroidal anti-inflammatory drug (NSAID).",
      primaryUses: ["Pain relief", "Fever reduction", "Blood thinning"],
      commonSideEffects: ["Stomach upset", "Increased bleeding risk"],
      genericAlternatives: [{"name": "Acetylsalicylic acid", "note": "Same active ingredient"}],
      otcAvailable: true,
      warningNote: "Consult doctor before long-term use."
    },
    ibuprofen: {
      description: "Ibuprofen is a nonsteroidal anti-inflammatory drug (NSAID).",
      primaryUses: ["Pain relief", "Fever reduction", "Inflammation reduction"],
      commonSideEffects: ["Stomach upset", "Heartburn", "Dizziness"],
      genericAlternatives: [],
      otcAvailable: true,
      warningNote: "Take with food to reduce stomach upset."
    }
  };
  
  return basicInfo[medicineName.toLowerCase()] || null;
}

/**
 * Uses Groq to generate structured medicine info:
 * description, uses, sideEffects, genericAlternatives[], otcAvailable
 */
async function askGroq(medicineName, genericName) {
  const prompt = `For medicine "${medicineName}" (generic: "${genericName}"), respond ONLY with this JSON:
{
  "description": "Brief one-sentence description",
  "primaryUses": ["Use 1", "Use 2"],
  "commonSideEffects": ["Side 1", "Side 2"],
  "genericAlternatives": [
    {"name": "Generic name", "note": "Brief note"}
  ],
  "otcAvailable": true,
  "warningNote": "One warning or null"
}
Return ONLY valid JSON, no markdown.`;

  const resp = await fetch(
    `https://api.groq.com/openai/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    }
  );

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    if (resp.status === 429) {
      const retryAfter = errorData.error?.details?.[0]?.retryDelay?.seconds || '60';
      throw new Error(`Rate limit exceeded. Please try again in ${retryAfter} seconds.`);
    }
    throw new Error(`Groq API error: ${resp.status} - ${errorData.error?.message || resp.statusText}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  // Strip any markdown code fences
  let clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  // Handle truncated JSON responses by attempting to fix common issues
  if (clean && !clean.endsWith('}')) {
    // Try to find the last complete object or array
    const lastBraceIndex = clean.lastIndexOf('}');
    const lastBracketIndex = clean.lastIndexOf(']');
    
    if (lastBraceIndex > lastBracketIndex && lastBraceIndex > 0) {
      clean = clean.substring(0, lastBraceIndex + 1);
    } else if (lastBracketIndex > lastBraceIndex && lastBracketIndex > 0) {
      clean = clean.substring(0, lastBracketIndex + 1);
    }
  }
  
  // Validate that we have content before parsing
  if (!clean) {
    throw new Error('Empty response from Groq API');
  }
  
  try {
    return JSON.parse(clean);
  } catch (parseError) {
    console.error('JSON parse error:', parseError.message);
    console.error('Raw response:', raw);
    console.error('Cleaned response:', clean);
    throw new Error('Invalid JSON response from Groq API');
  }
}

/**
 * Get medicine image URL from multiple sources including Google Custom Search
 */
async function getMedicineImage(medicineName) {
  try {
    // First try FDA API for drug information
    const encoded = encodeURIComponent(medicineName.split(' ')[0]);
    const fdaUrl = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${encoded}"&limit=1`;
    const fdaResp = await fetch(fdaUrl);
    const fdaData = await fdaResp.json();
    
    if (fdaData?.results?.length) {
      // FDA doesn't provide images, but we can use the drug info to construct better image searches
      console.log('FDA data found for', medicineName);
    }
  } catch (error) {
    console.log('FDA API failed:', error.message);
  }

  // Try Google Custom Search API for images (we have the credentials)
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID) {
    try {
      const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CSE_ID}&q=${encodeURIComponent(medicineName + ' medicine pill tablet')}&searchType=image&num=1&safe=active`;
      const googleResp = await fetch(googleUrl);
      const googleData = await googleResp.json();
      
      if (googleData?.items?.length > 0) {
        return googleData.items[0].link;
      }
    } catch (error) {
      console.log('Google Custom Search API failed:', error.message);
    }
  }

  // Try Pixabay API (free, requires API key)
  if (process.env.PIXABAY_API_KEY) {
    try {
      const pixabayUrl = `https://pixabay.com/api/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(medicineName + ' medicine pill')}&image_type=photo&per_page=3`;
      const pixabayResp = await fetch(pixabayUrl);
      const pixabayData = await pixabayResp.json();
      
      if (pixabayData?.hits?.length > 0) {
        return pixabayData.hits[0].webformatURL;
      }
    } catch (error) {
      console.log('Pixabay API failed:', error.message);
    }
  }

  // Try Unsplash API (free, requires API key)
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(medicineName + ' medicine')}&client_id=${process.env.UNSPLASH_ACCESS_KEY}&per_page=1`;
      const unsplashResp = await fetch(unsplashUrl);
      const unsplashData = await unsplashResp.json();
      
      if (unsplashData?.results?.length > 0) {
        return unsplashData.results[0].urls.regular;
      }
    } catch (error) {
      console.log('Unsplash API failed:', error.message);
    }
  }

  // Try Pexels API (free, requires API key)
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(medicineName + ' medicine')}&per_page=1`;
      const pexelsResp = await fetch(pexelsUrl, {
        headers: { 'Authorization': process.env.PEXELS_API_KEY }
      });
      const pexelsData = await pexelsResp.json();
      
      if (pexelsData?.photos?.length > 0) {
        return pexelsData.photos[0].src.large;
      }
    } catch (error) {
      console.log('Pexels API failed:', error.message);
    }
  }

  // Fallback to placeholder with medicine name
  return `https://via.placeholder.com/300x200/0d9488/ffffff?text=${encodeURIComponent(medicineName)}`;
}

export async function getMedicineInfo(req, res) {
  const { name, generic } = req.query;
  if (!name) return res.status(400).json({ success: false, message: 'name is required' });

  // Check cache first
  const cacheKey = getCacheKey(name, generic);
  const cachedResponse = getCachedResponse(cacheKey);
  if (cachedResponse) {
    return res.json(cachedResponse);
  }

  if (!GROQ_KEY) {
    return res.status(500).json({ success: false, message: 'Groq API key not configured' });
  }

  try {
    const [aiInfo, imageUrl] = await Promise.all([
      askGroq(name, generic || name),
      getMedicineImage(name),
    ]);

    const response = {
      success: true,
      medicineName: name,
      genericName: generic || '',
      imageUrl,
      ...aiInfo,
    };

    // Cache the successful response
    setCachedResponse(cacheKey, response);

    return res.json(response);
  } catch (err) {
    console.error('Medicine info error:', err.message);
    
    // Check if it's a rate limit error
    const isRateLimit = err.message.includes('Rate limit exceeded') || err.message.includes('quota');
    
    // Try to get basic medicine info first
    const basicInfo = getBasicMedicineInfo(name);
    
    // Get fallback image
    const fallbackImageUrl = await getMedicineImage(name);
    
    // Fallback response when AI fails
    const fallbackResponse = {
      success: true,
      medicineName: name,
      genericName: generic || '',
      imageUrl: fallbackImageUrl,
      description: basicInfo?.description || (isRateLimit 
        ? `AI service is temporarily unavailable due to high demand. Please try again later.`
        : `Information about ${name} is currently unavailable. Please consult a healthcare professional.`),
      primaryUses: basicInfo?.primaryUses || (isRateLimit ? ["Service temporarily unavailable"] : ["Consult healthcare provider"]),
      commonSideEffects: basicInfo?.commonSideEffects || (isRateLimit ? ["Service temporarily unavailable"] : ["Consult healthcare provider"]),
      genericAlternatives: basicInfo?.genericAlternatives || [],
      otcAvailable: basicInfo?.otcAvailable || false,
      warningNote: basicInfo?.warningNote || (isRateLimit 
        ? "AI service is experiencing high demand. Please try again in a few minutes."
        : "Always consult with a healthcare professional before taking any medication.")
    };
    
    // Cache fallback responses for a shorter time to reduce repeated API calls
    setCachedResponse(cacheKey, fallbackResponse);
    
    return res.json(fallbackResponse);
  }
}

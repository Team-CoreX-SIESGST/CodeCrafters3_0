const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

const callGemini = async (prompt) => {
    if (!GEMINI_API_KEY) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();
    const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        '';
    return text;
};

const extractJson = (text) => {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
};

const fallbackUrgency = (symptoms = '', description = '') => {
    const text = `${symptoms} ${description}`.toLowerCase();
    const keywords = ['chest pain', 'breath', 'bleeding', 'severe', 'unconscious', 'high fever'];
    const score = keywords.some((k) => text.includes(k)) ? 85 : 35;
    return {
        urgencyScore: score,
        summary: 'Basic urgency estimate generated without AI.',
        structuredQuery: description || symptoms
    };
};

export const analyzeUrgency = async ({ symptoms, description, problem }) => {
    const prompt = `You are a clinical triage assistant. Analyze urgency and structure the patient's query.
Return ONLY valid JSON with keys: urgencyScore (0-100 number), summary (string), structuredQuery (string).
Input:
Problem: ${problem || ''}
Symptoms: ${symptoms || ''}
Description: ${description || ''}`;

    const text = await callGemini(prompt);
    const parsed = extractJson(text);
    if (parsed?.urgencyScore !== undefined) return parsed;
    return fallbackUrgency(symptoms, description);
};

export const structureQuery = async ({ symptoms, description, problem }) => {
    const prompt = `Structure the patient's complaint clearly.
Return ONLY JSON with keys: structuredQuery (string), summary (string), urgencyScore (0-100 number).
Input:
Problem: ${problem || ''}
Symptoms: ${symptoms || ''}
Description: ${description || ''}`;

    const text = await callGemini(prompt);
    const parsed = extractJson(text);
    if (parsed?.structuredQuery) return parsed;
    return fallbackUrgency(symptoms, description);
};

export const summarizeConversation = async ({ transcript, notes }) => {
    const prompt = `Summarize the medical conversation and extract key insights.
Return ONLY JSON with keys: summary (string), insights (string).
Transcript: ${transcript || ''}
Doctor Notes: ${notes || ''}`;

    const text = await callGemini(prompt);
    const parsed = extractJson(text);
    if (parsed?.summary) return parsed;
    return {
        summary: 'Summary unavailable. Provide doctor notes for better insights.',
        insights: notes || ''
    };
};

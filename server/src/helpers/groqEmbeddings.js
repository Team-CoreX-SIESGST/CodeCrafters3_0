// src/helpers/groqEmbeddings.js
// Use Groq's OpenAI-compatible embeddings endpoint
// Model: nomic-embed-text-v1.5  →  768-dimensional float32 vectors

import "../config/env.js";

const GROQ_EMBED_URL = "https://api.groq.com/openai/v1/embeddings";
const EMBED_MODEL = "nomic-embed-text-v1.5";

/**
 * Embed a single text string using Groq's embedding API.
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} - 768-dimensional embedding vector
 */
export async function embedText(text) {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is not set. Add GROQ_API_KEY or GROQ_KEY to server/.env.");
  }

  const response = await fetch(GROQ_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: String(text).trim(),
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Groq embeddings API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Groq embeddings API returned an empty or invalid vector");
  }
  return embedding;
}

/**
 * Embed multiple texts in one batch.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts) {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is not set. Add GROQ_API_KEY or GROQ_KEY to server/.env.");
  }

  const response = await fetch(GROQ_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts.map((t) => String(t).trim()),
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Groq embeddings API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const sorted = [...(data?.data || [])].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}

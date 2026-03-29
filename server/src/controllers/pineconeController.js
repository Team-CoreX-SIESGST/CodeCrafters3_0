// src/controllers/pineconeController.js
// Pinecone RAG chatbot controller using Pinecone search plus Groq generation.

import "../config/env.js";
import crypto from "crypto";
import { Groq } from "groq-sdk";
import { upsertRecords, searchPineconeByText } from "../helpers/pineconeClient.js";
import ChatConversation from "../models/ChatConversation.js";
import {
  getCognitiveKnowledgeStats,
  searchCognitiveKnowledgeInMongo,
  streamCognitiveKnowledgeRecords,
} from "../services/cognitiveKnowledgeService.js";

const PINECONE_RECORD_BATCH_SIZE = 90;
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_HISTORY_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 6000;

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is missing. Set GROQ_API_KEY or GROQ_KEY in server/.env.");
  }
  return new Groq({ apiKey });
}

function buildRecordContext(chunk) {
  const metadata = chunk.metadata || {};
  const excerpt = (metadata.text || metadata.content || "(no text)")
    .slice(0, MAX_CONTEXT_CHARS)
    .trim();

  return [
    `ID: ${chunk.id || metadata.id || "unknown"}`,
    metadata.collection ? `Collection: ${metadata.collection}` : "",
    metadata.source ? `Source: ${metadata.source}` : "",
    metadata.recordType ? `Record type: ${metadata.recordType}` : "",
    metadata.occurredAt ? `Occurred at: ${metadata.occurredAt}` : "",
    metadata.userId ? `User: ${metadata.userId}` : "",
    metadata.stateLabel ? `State label: ${metadata.stateLabel}` : "",
    metadata.activeApp ? `Active app: ${metadata.activeApp}` : "",
    metadata.activeWindow ? `Active window: ${metadata.activeWindow}` : "",
    metadata.entityType ? `Entity type: ${metadata.entityType}` : "",
    metadata.entityId ? `Entity id: ${metadata.entityId}` : "",
    metadata.relationType ? `Relation type: ${metadata.relationType}` : "",
    metadata.label ? `Label: ${metadata.label}` : "",
    metadata.message ? `Message: ${metadata.message}` : "",
    `Text: ${excerpt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function wantsDetailedResponse(query) {
  const normalized = String(query || "").toLowerCase();
  if (!normalized.trim()) return false;

  const detailedPatterns = [
    "detailed",
    "detail",
    "explain",
    "explanation",
    "summary of my activities",
    "summarize my activities",
    "give me the summary of my activities",
    "what did i do",
    "what was i doing",
    "my activities",
    "activity summary",
    "walk me through",
  ];

  return detailedPatterns.some((pattern) => normalized.includes(pattern));
}

function buildResponseStyleInstructions(query) {
  if (wantsDetailedResponse(query)) {
    return [
      "The user wants a fuller explanation, not a one-line answer.",
      "Give a detailed but readable summary in natural language.",
      "For activity-summary questions, explain the main work, the tools or files involved, the focus patterns, and any notable changes over time.",
      "Prefer 2-4 short paragraphs or a few clear bullets if that reads better.",
      "Keep it user-friendly and insight-oriented rather than technical.",
    ].join("\n");
  }

  return [
    "Prefer a concise answer unless the user asks for more detail.",
    "Keep the response easy to read and focused on the most useful takeaways.",
  ].join("\n");
}

function buildSystemPrompt(retrievedChunks, query) {
  const contextBlock =
    retrievedChunks.length > 0
      ? retrievedChunks.map((chunk) => buildRecordContext(chunk)).join("\n\n")
      : "No relevant context was found in the knowledge base for this query.";
  const responseStyleInstructions = buildResponseStyleInstructions(query);

  return `You are Luna, an intelligent AI assistant backed by a curated knowledge base.
When answering, use the CONTEXT below as your primary source of truth.
If the context does not contain enough information, say so clearly and answer from your general knowledge.
Always be concise, helpful, and professional.

=== KNOWLEDGE BASE CONTEXT ===
${contextBlock}
=== END OF CONTEXT ===

Instructions:
- Turn raw records into clear, natural, user-friendly sentences.
- Do not dump database-style key/value fields unless the user explicitly asks for raw data.
- Do not include source ids, citations, or "Source records" sections unless the user explicitly asks for them.
- Summarize timestamps, apps, windows, states, and events in normal prose that a non-technical user can understand.
- If the records are noisy or repetitive, synthesize them into a short, meaningful summary instead of listing every field.
- Match the depth of the answer to the user's request.
- ${responseStyleInstructions}
- If the user's question is unrelated to the context, answer using general knowledge and note that.`;
}

async function describePineconeIndex() {
  const { getPineconeIndex } = await import("../helpers/pineconeClient.js");
  const stats = await getPineconeIndex().describeIndexStats();
  return {
    namespaces: stats.namespaces || {},
    dimension: stats.dimension || null,
    totalRecordCount: stats.totalRecordCount || 0,
    indexFullness: stats.indexFullness || 0,
  };
}

function normalizeSourcePreview(chunk) {
  const metadata = chunk.metadata || {};
  return {
    id: chunk.id,
    score: chunk.score,
    text: (metadata.text || metadata.content || "").slice(0, 300).trim(),
    source: metadata.source || "",
    collection: metadata.collection || "",
    recordType: metadata.recordType || "",
    occurredAt: metadata.occurredAt || "",
    userId: metadata.userId || "",
    stateLabel: metadata.stateLabel || "",
    activeApp: metadata.activeApp || "",
    activeWindow: metadata.activeWindow || "",
    entityType: metadata.entityType || "",
    entityId: metadata.entityId || "",
    relationType: metadata.relationType || "",
    label: metadata.label || "",
    message: metadata.message || "",
  };
}

export async function handlePineconeChat(req, res) {
  const { query, conversationId, namespace } = req.body || {};
  const userId = req.user?._id;

  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    send("status", { message: "Searching knowledge base..." });
    try {
      const pineconeStats = await describePineconeIndex();
      console.log("[pineconeChat] Pinecone stats:", pineconeStats);
    } catch (statsErr) {
      console.warn("[pineconeChat] Unable to fetch Pinecone stats:", statsErr.message);
    }

    let retrievedChunks = [];
    try {
      retrievedChunks = await searchPineconeByText(query.trim(), 5, undefined, ns);
    } catch (pcErr) {
      console.warn("[pinecone] Query failed:", pcErr.message);
      send("status", { message: "Knowledge base unavailable, answering from general knowledge..." });
    }

    if (retrievedChunks.length === 0) {
      send("status", { message: "No Pinecone matches found. Checking cognitive database..." });
      retrievedChunks = await searchCognitiveKnowledgeInMongo(query.trim(), { limit: 5 });
    }

    if (retrievedChunks.length > 0) {
      send("sources", {
        sources: retrievedChunks.map(normalizeSourcePreview),
      });
    }

    let conversation;
    if (conversationId) {
      conversation = await ChatConversation.findOne({
        _id: conversationId,
        userId,
      });
    }
    if (!conversation) {
      conversation = new ChatConversation({
        userId,
        title: query.slice(0, 60) + (query.length > 60 ? "..." : ""),
        namespace: ns,
        messages: [],
      });
    }

    send("conversationId", { conversationId: conversation._id.toString() });

    const recentHistory = conversation.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));

    const groqMessages = [
      { role: "system", content: buildSystemPrompt(retrievedChunks, query.trim()) },
      ...recentHistory,
      { role: "user", content: query.trim() },
    ];

    send("status", { message: "Generating response..." });

    let fullResponse = "";
    try {
      const groq = getGroqClient();
      const stream = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: groqMessages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.4,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          send("message", { text: delta });
        }
        if (chunk.choices?.[0]?.finish_reason) {
          send("finish", { finishReason: chunk.choices[0].finish_reason });
        }
      }
    } catch (groqErr) {
      send("error", { error: `LLM error: ${groqErr.message}` });
      return res.end();
    }

    conversation.messages.push(
      { role: "user", content: query.trim(), sources: [] },
      {
        role: "assistant",
        content: fullResponse,
        sources: retrievedChunks.map((chunk) => ({
          ...normalizeSourcePreview(chunk),
          metadata: chunk.metadata,
        })),
      },
    );
    await conversation.save();

    send("done", { conversationId: conversation._id.toString() });
    res.end();
  } catch (err) {
    console.error("[pineconeChat] Unhandled error:", err);
    if (!res.writableEnded) {
      send("error", { error: err.message || "Internal server error" });
      res.end();
    }
  }
}

export async function handleUpsertDocuments(req, res) {
  try {
    const { documents, namespace } = req.body || {};
    if (!Array.isArray(documents) || documents.length === 0) {
      return res
        .status(400)
        .json({ error: "documents array is required and must not be empty" });
    }

    const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
    const texts = documents.map((document) => String(document.text || "").trim());
    const records = texts
      .map((text, index) => ({ text, doc: documents[index] }))
      .filter((item) => item.text.length > 0)
      .map(({ text, doc }) => ({
        id: doc.id || crypto.randomUUID(),
        text: text.slice(0, 40000),
        source: doc.source || "manual",
        ...(doc.metadata || {}),
      }));

    if (records.length === 0) {
      return res.status(400).json({ error: "No non-empty document text was provided" });
    }

    await upsertRecords(records, ns);

    res.json({
      success: true,
      upserted: records.length,
      namespace: ns,
      ids: records.map((record) => record.id),
    });
  } catch (err) {
    console.error("[upsertDocuments] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function getPineconeKnowledgeStats(req, res) {
  try {
    const [mongoKnowledge, pinecone] = await Promise.all([
      getCognitiveKnowledgeStats(),
      describePineconeIndex(),
    ]);

    res.json({
      success: true,
      mongoKnowledge,
      pinecone,
      namespace: process.env.PINECONE_NAMESPACE || "default",
    });
  } catch (err) {
    console.error("[getPineconeKnowledgeStats] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function seedCognitiveKnowledge(req, res) {
  try {
    const namespace = req.body?.namespace || process.env.PINECONE_NAMESPACE || "default";
    let upserted = 0;
    let batches = 0;

    for await (const batch of streamCognitiveKnowledgeRecords(PINECONE_RECORD_BATCH_SIZE)) {
      await upsertRecords(batch, namespace);
      upserted += batch.length;
      batches += 1;
    }

    res.json({
      success: true,
      namespace,
      upserted,
      batches,
    });
  } catch (err) {
    console.error("[seedCognitiveKnowledge] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function getConversations(req, res) {
  try {
    const userId = req.user?._id;
    const conversations = await ChatConversation.find({ userId })
      .select("_id title createdAt updatedAt namespace")
      .sort({ updatedAt: -1 })
      .limit(50);
    res.json(conversations);
  } catch (err) {
    console.error("[getConversations] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function getConversationById(req, res) {
  try {
    const userId = req.user?._id;
    const conversation = await ChatConversation.findOne({
      _id: req.params.id,
      userId,
    });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json(conversation);
  } catch (err) {
    console.error("[getConversationById] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

export async function deleteConversation(req, res) {
  try {
    const userId = req.user?._id;
    const result = await ChatConversation.findOneAndDelete({
      _id: req.params.id,
      userId,
    });
    if (!result) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[deleteConversation] Error:", err);
    res.status(500).json({ error: err.message });
  }
}

// src/controllers/pineconeController.js
// Pinecone RAG chatbot controller — uses Groq embeddings + Pinecone search + Groq LLM

import "../config/env.js";
import { upsertRecords, searchPineconeByText } from "../helpers/pineconeClient.js";
import ChatConversation from "../models/ChatConversation.js";
import {
  getCognitiveKnowledgeStats,
  searchCognitiveKnowledgeInMongo,
  streamCognitiveKnowledgeRecords,
} from "../services/cognitiveKnowledgeService.js";
import { Groq } from "groq-sdk";
import crypto from "crypto";

const PINECONE_RECORD_BATCH_SIZE = 90;

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is missing. Set GROQ_API_KEY or GROQ_KEY in server/.env.");
  }
  return new Groq({ apiKey });
}

const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_HISTORY_MESSAGES = 8; // number of past messages to include in context
const MAX_CONTEXT_CHARS = 6000; // max chars of retrieved chunks to include

// ─── System Prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(retrievedChunks) {
  const contextBlock =
    retrievedChunks.length > 0
      ? retrievedChunks
          .map(
            (c, i) =>
              `[Source ${i + 1}${c.metadata?.source ? ` — ${c.metadata.source}` : ""}]\n${c.metadata?.text || c.metadata?.content || "(no text)"}`
          )
          .join("\n\n")
      : "No relevant context was found in the knowledge base for this query.";

  return `You are Luna, an intelligent AI assistant backed by a curated knowledge base.
When answering, use the CONTEXT below as your primary source of truth.
If the context doesn't contain enough information, say so clearly and answer from your general knowledge.
Always be concise, helpful, and professional.

=== KNOWLEDGE BASE CONTEXT ===
${contextBlock}
=== END OF CONTEXT ===

Instructions:
- Cite the source numbers [Source N] inline when referencing retrieved content.
- If multiple sources agree, cite all relevant ones.
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
  return {
    id: chunk.id,
    score: chunk.score,
    text: (chunk.metadata?.text || chunk.metadata?.content || "").slice(0, 300).trim(),
    source: chunk.metadata?.source || "",
  };
}

// ─── POST /api/pinecone/chat  (streaming SSE) ─────────────────────────────────
export async function handlePineconeChat(req, res) {
  const { query, conversationId, namespace } = req.body || {};
  const userId = req.user?._id;

  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";

  // --- Set up SSE headers ---
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
    send("status", { message: "Searching knowledge base…" });
    let pineconeStats = null;
    try {
      pineconeStats = await describePineconeIndex();
      console.log("[pineconeChat] Pinecone stats:", pineconeStats);
    } catch (statsErr) {
      console.warn("[pineconeChat] Unable to fetch Pinecone stats:", statsErr.message);
    }

    let retrievedChunks = [];
    try {
      retrievedChunks = await searchPineconeByText(query.trim(), 5, undefined, ns);
    } catch (pcErr) {
      // Non-fatal — continue without context
      console.warn("[pinecone] Query failed:", pcErr.message);
      send("status", { message: "Knowledge base unavailable, answering from general knowledge…" });
    }

    if (retrievedChunks.length === 0) {
      send("status", { message: "No Pinecone matches found. Checking cognitive database…" });
      retrievedChunks = await searchCognitiveKnowledgeInMongo(query.trim(), { limit: 5 });
    }

    // Send source metadata to client
    if (retrievedChunks.length > 0) {
      send("sources", {
        sources: retrievedChunks.map(normalizeSourcePreview),
      });
    }

    // 3. Load or create conversation (MongoDB)
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
        title: query.slice(0, 60) + (query.length > 60 ? "…" : ""),
        namespace: ns,
        messages: [],
      });
    }

    // Send conversation ID to client
    send("conversationId", { conversationId: conversation._id.toString() });

    // 4. Build message history for Groq
    const recentHistory = conversation.messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));

    const systemPrompt = buildSystemPrompt(retrievedChunks);

    const groqMessages = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: query.trim() },
    ];

    // 5. Stream Groq response
    send("status", { message: "Generating response…" });

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

    // 6. Persist both turns to MongoDB
    conversation.messages.push(
      { role: "user", content: query.trim(), sources: [] },
      {
        role: "assistant",
        content: fullResponse,
        sources: retrievedChunks.map((c) => ({
          id: c.id,
          score: c.score,
          text: (c.metadata?.text || c.metadata?.content || "").slice(0, 500),
          source: c.metadata?.source || "",
          metadata: c.metadata,
        })),
      }
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

// ─── POST /api/pinecone/upsert  — ingest text chunks into Pinecone ────────────
export async function handleUpsertDocuments(req, res) {
  try {
    const { documents, namespace } = req.body || {};
    // documents: Array<{ id?: string, text: string, source?: string, metadata?: object }>
    if (!Array.isArray(documents) || documents.length === 0) {
      return res
        .status(400)
        .json({ error: "documents array is required and must not be empty" });
    }

    const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
    const texts = documents.map((d) => String(d.text || "").trim());
    const records = texts
      .map((text, i) => ({ text, doc: documents[i] }))
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

// ─── GET /api/pinecone/conversations  — list user's chat conversations ────────
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

// ─── GET /api/pinecone/conversations/:id  — get a single conversation ─────────
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

// ─── DELETE /api/pinecone/conversations/:id ───────────────────────────────────
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

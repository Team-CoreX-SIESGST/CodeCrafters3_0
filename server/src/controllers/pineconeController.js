// src/controllers/pineconeController.js
// Pinecone RAG chatbot controller — uses Groq embeddings + Pinecone search + Groq LLM

import "../config/env.js";
import { embedText, embedBatch } from "../helpers/groqEmbeddings.js";
import { upsertVectors, queryPinecone } from "../helpers/pineconeClient.js";
import ChatConversation from "../models/ChatConversation.js";
import { Groq } from "groq-sdk";
import crypto from "crypto";

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
    // 1. Embed the query
    send("status", { message: "Searching knowledge base…" });
    let embedding;
    try {
      embedding = await embedText(query.trim());
    } catch (embErr) {
      send("error", { error: `Embedding failed: ${embErr.message}` });
      return res.end();
    }

    // 2. Query Pinecone
    let retrievedChunks = [];
    try {
      retrievedChunks = await queryPinecone(embedding, 5, undefined, ns);
    } catch (pcErr) {
      // Non-fatal — continue without context
      console.warn("[pinecone] Query failed:", pcErr.message);
      send("status", { message: "Knowledge base unavailable, answering from general knowledge…" });
    }

    // Send source metadata to client
    if (retrievedChunks.length > 0) {
      send("sources", {
        sources: retrievedChunks.map((c) => ({
          id: c.id,
          score: c.score,
          text:
            (c.metadata?.text || c.metadata?.content || "")
              .slice(0, 300)
              .trim(),
          source: c.metadata?.source || "",
        })),
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

    // Embed all texts in one batch
    const texts = documents.map((d) => String(d.text || "").trim());
    const embeddings = await embedBatch(texts);

    const vectors = documents.map((doc, i) => ({
      id: doc.id || crypto.randomUUID(),
      values: embeddings[i],
      metadata: {
        text: texts[i].slice(0, 1000), // Pinecone metadata limit
        source: doc.source || "manual",
        ...(doc.metadata || {}),
      },
    }));

    await upsertVectors(vectors, ns);

    res.json({
      success: true,
      upserted: vectors.length,
      namespace: ns,
      ids: vectors.map((v) => v.id),
    });
  } catch (err) {
    console.error("[upsertDocuments] Error:", err);
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

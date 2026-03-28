// src/routes/pineconeRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  handlePineconeChat,
  handleUpsertDocuments,
  getConversations,
  getConversationById,
  deleteConversation,
} from "../controllers/pineconeController.js";

const router = express.Router();

// ── Chat (streaming SSE) ─────────────────────────────────────────────────────
// POST /api/pinecone/chat
router.post("/chat", protect, handlePineconeChat);

// ── Document ingestion ───────────────────────────────────────────────────────
// POST /api/pinecone/upsert
router.post("/upsert", protect, handleUpsertDocuments);

// ── Conversation history (MongoDB) ───────────────────────────────────────────
// GET  /api/pinecone/conversations
router.get("/conversations", protect, getConversations);

// GET  /api/pinecone/conversations/:id
router.get("/conversations/:id", protect, getConversationById);

// DELETE /api/pinecone/conversations/:id
router.delete("/conversations/:id", protect, deleteConversation);

export default router;

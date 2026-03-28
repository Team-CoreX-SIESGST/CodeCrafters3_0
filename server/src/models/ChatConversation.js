// src/models/ChatConversation.js
// Stores Pinecone-based RAG chat history in MongoDB

import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    // Retrieved source chunks from Pinecone (only on assistant messages)
    sources: [
      {
        id: String,
        score: Number,
        text: String,
        source: String,   // e.g., filename, URL, document title
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true }
);

const chatConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "New Chat",
      trim: true,
    },
    messages: [messageSchema],
    // Pinecone namespace used for this conversation (optional scoping)
    namespace: {
      type: String,
      default: "default",
    },
  },
  { timestamps: true }
);

const ChatConversation = mongoose.model(
  "ChatConversation",
  chatConversationSchema
);

export default ChatConversation;

"use client"

/**
 * PineconeChatPanel.jsx
 * A floating slide-over panel that provides a Pinecone RAG chatbot
 * powered by Groq. Sits inside the existing /chat page.
 */

import React, { useState, useRef, useEffect, useCallback } from "react"
import { SERVER_URL } from "@/utils/commonHelper"
import { useAuth } from "@/contexts/auth-context"
import {
  X,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  MessageSquare,
  Plus,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react"

const PINECONE_BASE = `${SERVER_URL}/api/pinecone`

// ── tiny helpers ────────────────────────────────────────────────────────────

function SourceBadge({ source, index }) {
  const [open, setOpen] = useState(false)
  const score = source.score != null ? Math.round(source.score * 100) : null
  return (
    <div className="pc-source-badge">
      <button className="pc-source-header" onClick={() => setOpen((o) => !o)}>
        <span className="pc-source-num">[{index + 1}]</span>
        <span className="pc-source-title">{source.source || "Knowledge Base"}</span>
        {score != null && <span className="pc-source-score">{score}%</span>}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && source.text && (
        <p className="pc-source-text">{source.text}</p>
      )}
    </div>
  )
}

function ChatBubble({ msg }) {
  const isUser = msg.role === "user"
  const hasSources = !isUser && Array.isArray(msg.sources) && msg.sources.length > 0
  const [showSrc, setShowSrc] = useState(false)

  return (
    <div className={`pc-bubble-wrap ${isUser ? "pc-bubble-user" : "pc-bubble-ai"}`}>
      {!isUser && (
        <div className="pc-avatar-ai">
          <Sparkles size={12} />
        </div>
      )}
      <div className="pc-bubble">
        <p className="pc-bubble-text">{msg.content}</p>
        {hasSources && (
          <div className="pc-sources-block">
            <button
              className="pc-sources-toggle"
              onClick={() => setShowSrc((s) => !s)}
            >
              <BookOpen size={11} />
              {msg.sources.length} source{msg.sources.length > 1 ? "s" : ""}
              {showSrc ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {showSrc && (
              <div className="pc-sources-list">
                {msg.sources.map((src, i) => (
                  <SourceBadge key={src.id || i} source={src} index={i} />
                ))}
              </div>
            )}
          </div>
        )}
        <span className="pc-bubble-time">
          {new Date(msg.createdAt || Date.now()).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="pc-bubble-wrap pc-bubble-ai">
      <div className="pc-avatar-ai">
        <Sparkles size={12} />
      </div>
      <div className="pc-bubble pc-typing">
        <span /><span /><span />
      </div>
    </div>
  )
}

// ── History sidebar item ─────────────────────────────────────────────────────
function HistoryItem({ conv, active, onSelect, onDelete }) {
  return (
    <div
      className={`pc-hist-item ${active ? "pc-hist-active" : ""}`}
      onClick={() => onSelect(conv._id)}
    >
      <MessageSquare size={13} className="pc-hist-icon" />
      <span className="pc-hist-title">
        {conv.title || `Chat ${conv._id.slice(-6)}`}
      </span>
      <button
        className="pc-hist-del"
        onClick={(e) => { e.stopPropagation(); onDelete(conv._id) }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function PineconeChatPanel({ onClose }) {
  const { token } = useAuth()
  const [storedToken, setStoredToken] = useState(null)

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [sources, setSources] = useState([])
  const [convId, setConvId] = useState(null)

  const [conversations, setConversations] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [histLoading, setHistLoading] = useState(false)

  const abortRef = useRef(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const authToken = token || storedToken || null

  useEffect(() => {
    if (typeof window === "undefined") return
    setStoredToken(
      window.localStorage.getItem("token") ||
      window.localStorage.getItem("authToken") ||
      null,
    )
  }, [token])

  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }), [authToken])

  // ── scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isStreaming])

  // ── load conversation list ────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setHistLoading(true)
    try {
      const res = await fetch(`${PINECONE_BASE}/conversations`, {
        headers: authHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        setConversations(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.warn("[PineconePanel] loadConversations:", e)
    } finally {
      setHistLoading(false)
    }
  }, [authHeaders])

  // ── select conversation ───────────────────────────────────────────────────
  const selectConversation = useCallback(async (id) => {
    try {
      const res = await fetch(`${PINECONE_BASE}/conversations/${id}`, {
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      const msgs = (data.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        sources: m.sources || [],
        createdAt: m.createdAt,
      }))
      setMessages(msgs)
      setConvId(id)
      setShowHistory(false)
    } catch (e) {
      console.error("[PineconePanel] selectConversation:", e)
    }
  }, [authHeaders])

  // ── delete conversation ───────────────────────────────────────────────────
  const deleteConversation = useCallback(async (id) => {
    try {
      await fetch(`${PINECONE_BASE}/conversations/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      })
      setConversations((prev) => prev.filter((c) => c._id !== id))
      if (convId === id) {
        setMessages([])
        setConvId(null)
      }
    } catch (e) {
      console.error("[PineconePanel] deleteConversation:", e)
    }
  }, [authHeaders, convId])

  // ── new chat ─────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setConvId(null)
    setSources([])
    setStatusMsg("")
    setIsStreaming(false)
    setShowHistory(false)
  }, [])

  // ── send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || isStreaming) return

    setInput("")
    setSources([])
    setStatusMsg("")
    setMessages((prev) => [
      ...prev,
      { role: "user", content: query, createdAt: new Date() },
    ])
    setIsStreaming(true)

    // placeholder assistant message we'll stream into
    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", sources: [], createdAt: new Date() },
    ])

    abortRef.current = new AbortController()

    try {
      const res = await fetch(`${PINECONE_BASE}/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ query, conversationId: convId }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) throw new Error(await res.text())

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let currentEvent = ""
      let accText = ""
      let msgSources = []

      const processLine = (line) => {
        if (!line.trim()) { currentEvent = ""; return }
        if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); return }
        if (!line.startsWith("data: ")) return
        const raw = line.slice(6).trim()
        if (!raw) return
        try {
          const parsed = JSON.parse(raw)

          if (currentEvent === "status") {
            setStatusMsg(parsed.message || "")
          } else if (currentEvent === "sources") {
            msgSources = parsed.sources || []
            setSources(msgSources)
          } else if (currentEvent === "conversationId") {
            if (parsed.conversationId) setConvId(parsed.conversationId)
          } else if (currentEvent === "message" && parsed.text) {
            accText += parsed.text
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: accText }
                  : m
              )
            )
          } else if (currentEvent === "done") {
            // finalise message with sources
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: accText, sources: msgSources }
                  : m
              )
            )
          } else if (currentEvent === "error") {
            throw new Error(parsed.error || "Unknown error")
          }
        } catch (parseErr) {
          console.warn("[PineconePanel] SSE parse:", parseErr)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) { buffer.trim() && buffer.split("\n").forEach(processLine); break }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        lines.forEach(processLine)
      }

      // Refresh history list in background
      loadConversations()
    } catch (err) {
      if (err.name === "AbortError") return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠️ Error: ${err.message}` }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
      setStatusMsg("")
    }
  }, [input, isStreaming, convId, authHeaders, loadConversations])

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Load conversations on mount
  useEffect(() => { loadConversations() }, [loadConversations])

  return (
    <>
      <style>{`
        /* ═══════════════════════════════════════════════════════
           PineconeChatPanel — self-contained styles
           ═══════════════════════════════════════════════════════ */
        .pc-panel {
          position: fixed;
          top: 0; right: 0; bottom: 0;
          width: min(420px, 100vw);
          z-index: 999;
          display: flex;
          flex-direction: column;
          background: rgba(8, 10, 18, 0.97);
          border-left: 1px solid rgba(139, 92, 246, 0.25);
          box-shadow: -8px 0 40px rgba(0,0,0,0.6), -2px 0 0 rgba(139,92,246,0.1);
          backdrop-filter: blur(28px);
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          animation: pcSlideIn 0.28s cubic-bezier(0.16,1,0.3,1) both;
        }
        @keyframes pcSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        /* ── Header ─────────────────────────────────── */
        .pc-header {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(139,92,246,0.15);
          background: rgba(139,92,246,0.06);
          flex-shrink: 0;
        }
        .pc-header-icon {
          width: 32px; height: 32px; border-radius: 8px;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          display: flex; align-items: center; justify-content: center;
          color: #fff; flex-shrink: 0;
          box-shadow: 0 0 14px rgba(168,85,247,0.4);
        }
        .pc-header-text { flex: 1; min-width: 0; }
        .pc-header-title {
          font-size: 13px; font-weight: 700;
          color: rgba(240,235,255,0.95);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pc-header-sub {
          font-size: 10px; color: rgba(200,190,255,0.4);
          margin-top: 1px;
        }
        .pc-header-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .pc-icon-btn {
          width: 30px; height: 30px; border-radius: 7px; border: none;
          background: rgba(255,255,255,0.06);
          color: rgba(200,190,255,0.55);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.15s, color 0.15s;
        }
        .pc-icon-btn:hover { background: rgba(139,92,246,0.18); color: #c4b5fd; }
        .pc-icon-btn.pc-close:hover { background: rgba(239,68,68,0.15); color: #f87171; }

        /* ── Toolbar ────────────────────────────────── */
        .pc-toolbar {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          flex-shrink: 0;
        }
        .pc-toolbar-btn {
          display: flex; align-items: center; gap: 5px;
          padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: rgba(200,190,255,0.6); font-size: 11px; font-weight: 500;
          cursor: pointer; transition: all 0.15s;
        }
        .pc-toolbar-btn:hover { background: rgba(139,92,246,0.14); border-color: rgba(139,92,246,0.3); color: #c4b5fd; }
        .pc-toolbar-btn.pc-active { background: rgba(139,92,246,0.18); border-color: rgba(139,92,246,0.4); color: #c4b5fd; }
        .pc-conv-badge {
          margin-left: auto;
          font-size: 10px; color: rgba(200,190,255,0.35);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 130px;
        }

        /* ── History Dropdown ───────────────────────── */
        .pc-history-dropdown {
          border-bottom: 1px solid rgba(255,255,255,0.07);
          background: rgba(12,10,28,0.95);
          max-height: 220px; overflow-y: auto; flex-shrink: 0;
        }
        .pc-history-dropdown::-webkit-scrollbar { width: 3px; }
        .pc-history-dropdown::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 2px; }
        .pc-hist-item {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 14px; cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.12s;
        }
        .pc-hist-item:hover { background: rgba(139,92,246,0.1); }
        .pc-hist-active { background: rgba(139,92,246,0.15) !important; }
        .pc-hist-icon { color: rgba(168,85,247,0.6); flex-shrink: 0; }
        .pc-hist-title {
          flex: 1; font-size: 12px; color: rgba(220,210,255,0.7);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pc-hist-active .pc-hist-title { color: #d8b4fe; }
        .pc-hist-del {
          color: rgba(255,255,255,0.2); border: none; background: transparent;
          cursor: pointer; padding: 2px; border-radius: 4px;
          display: flex; transition: color 0.12s, background 0.12s;
        }
        .pc-hist-del:hover { color: #f87171; background: rgba(239,68,68,0.12); }
        .pc-hist-empty {
          padding: 18px 14px; font-size: 11px; color: rgba(200,190,255,0.3);
          text-align: center;
        }

        /* ── Messages ───────────────────────────────── */
        .pc-messages {
          flex: 1; overflow-y: auto;
          padding: 16px 14px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .pc-messages::-webkit-scrollbar { width: 3px; }
        .pc-messages::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.25); border-radius: 2px; }

        /* ── Bubble ─────────────────────────────────── */
        .pc-bubble-wrap {
          display: flex; align-items: flex-end; gap: 8px;
        }
        .pc-bubble-user { flex-direction: row-reverse; }
        .pc-avatar-ai {
          width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 10px;
          box-shadow: 0 0 10px rgba(168,85,247,0.35);
        }
        .pc-bubble {
          max-width: 88%;
          padding: 10px 13px 8px;
          border-radius: 14px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .pc-bubble-ai .pc-bubble {
          background: rgba(139,92,246,0.1);
          border: 1px solid rgba(139,92,246,0.2);
          border-bottom-left-radius: 4px;
        }
        .pc-bubble-user .pc-bubble {
          background: rgba(124,58,237,0.22);
          border: 1px solid rgba(139,92,246,0.35);
          border-bottom-right-radius: 4px;
          align-items: flex-end;
        }
        .pc-bubble-text {
          font-size: 13px; line-height: 1.55;
          color: rgba(240,235,255,0.88);
          white-space: pre-wrap; word-break: break-word;
          margin: 0;
        }
        .pc-bubble-user .pc-bubble-text { color: rgba(240,235,255,0.92); }
        .pc-bubble-time {
          font-size: 9px; color: rgba(200,190,255,0.3);
          align-self: flex-end;
        }

        /* ── Sources ────────────────────────────────── */
        .pc-sources-block { display: flex; flex-direction: column; gap: 4px; }
        .pc-sources-toggle {
          display: flex; align-items: center; gap: 4px;
          font-size: 10px; color: rgba(168,85,247,0.7);
          background: transparent; border: none; cursor: pointer;
          padding: 0; transition: color 0.12s;
        }
        .pc-sources-toggle:hover { color: #a855f7; }
        .pc-sources-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
        .pc-source-badge {
          background: rgba(88,28,135,0.15);
          border: 1px solid rgba(139,92,246,0.2);
          border-radius: 6px; overflow: hidden;
        }
        .pc-source-header {
          display: flex; align-items: center; gap: 5px;
          padding: 5px 8px; width: 100%; border: none;
          background: transparent; cursor: pointer; text-align: left;
          color: rgba(200,190,255,0.7); font-size: 10px;
        }
        .pc-source-num { color: #a855f7; font-weight: 700; }
        .pc-source-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pc-source-score {
          color: rgba(168,85,247,0.6); font-size: 9px; font-weight: 600;
        }
        .pc-source-text {
          padding: 5px 8px 6px;
          font-size: 10px; line-height: 1.5;
          color: rgba(200,190,255,0.55);
          border-top: 1px solid rgba(139,92,246,0.12);
          margin: 0;
        }

        /* ── Typing indicator ───────────────────────── */
        .pc-typing {
          padding: 10px 14px !important;
          flex-direction: row !important;
          align-items: center; gap: 5px !important;
        }
        .pc-typing span {
          width: 6px; height: 6px; border-radius: 50%;
          background: rgba(168,85,247,0.7);
          animation: pcBounce 1.1s infinite ease-in-out;
        }
        .pc-typing span:nth-child(2) { animation-delay: 0.17s; }
        .pc-typing span:nth-child(3) { animation-delay: 0.34s; }
        @keyframes pcBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-5px); opacity: 1; }
        }

        /* ── Empty state ─────────────────────────────── */
        .pc-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          text-align: center; padding: 24px;
        }
        .pc-empty-icon {
          width: 52px; height: 52px; border-radius: 14px;
          background: rgba(139,92,246,0.12);
          border: 1px solid rgba(139,92,246,0.2);
          display: flex; align-items: center; justify-content: center;
          color: rgba(168,85,247,0.6);
        }
        .pc-empty-title {
          font-size: 14px; font-weight: 600;
          color: rgba(240,235,255,0.7);
        }
        .pc-empty-sub {
          font-size: 11px; color: rgba(200,190,255,0.35);
          max-width: 240px; line-height: 1.5;
        }
        .pc-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 4px; }
        .pc-chip {
          padding: 5px 10px; border-radius: 20px;
          border: 1px solid rgba(139,92,246,0.25);
          background: rgba(139,92,246,0.08);
          color: rgba(200,190,255,0.6); font-size: 11px;
          cursor: pointer; transition: all 0.15s;
        }
        .pc-chip:hover { background: rgba(139,92,246,0.18); color: #c4b5fd; border-color: rgba(139,92,246,0.4); }

        /* ── Status bar ─────────────────────────────── */
        .pc-status-bar {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 14px;
          font-size: 11px; color: rgba(168,85,247,0.7);
          border-top: 1px solid rgba(139,92,246,0.1);
          background: rgba(139,92,246,0.04);
          flex-shrink: 0;
        }

        /* ── Footer / Input ─────────────────────────── */
        .pc-footer {
          padding: 12px 14px;
          border-top: 1px solid rgba(255,255,255,0.06);
          background: rgba(10,8,24,0.8);
          flex-shrink: 0;
        }
        .pc-input-row {
          display: flex; align-items: flex-end; gap: 8px;
        }
        .pc-textarea {
          flex: 1; resize: none; outline: none;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(139,92,246,0.2);
          border-radius: 10px; padding: 9px 12px;
          font-size: 13px; color: rgba(240,235,255,0.88);
          font-family: inherit; line-height: 1.45;
          max-height: 120px; min-height: 38px;
          transition: border-color 0.15s, box-shadow 0.15s;
          scrollbar-width: none;
        }
        .pc-textarea:focus {
          border-color: rgba(139,92,246,0.5);
          box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
        }
        .pc-textarea::placeholder { color: rgba(200,190,255,0.3); }
        .pc-send-btn {
          width: 38px; height: 38px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: #fff; display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          transition: opacity 0.15s, box-shadow 0.15s, transform 0.12s;
          box-shadow: 0 0 14px rgba(168,85,247,0.3);
        }
        .pc-send-btn:hover:not(:disabled) { box-shadow: 0 0 20px rgba(168,85,247,0.5); transform: scale(1.04); }
        .pc-send-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        .pc-input-hint {
          margin-top: 6px; font-size: 10px; color: rgba(200,190,255,0.25);
          text-align: center;
        }
      `}</style>

      <div className="pc-panel">
        {/* Header */}
        <div className="pc-header">
          <div className="pc-header-icon">
            <Database size={14} />
          </div>
          <div className="pc-header-text">
            <div className="pc-header-title">Knowledge Bot</div>
            <div className="pc-header-sub">Pinecone RAG · Groq LLM</div>
          </div>
          <div className="pc-header-actions">
            <button
              id="pcc-new-chat-btn"
              className="pc-icon-btn"
              title="New chat"
              onClick={startNewChat}
            >
              <Plus size={14} />
            </button>
            <button
              id="pcc-close-btn"
              className="pc-icon-btn pc-close"
              title="Close panel"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="pc-toolbar">
          <button
            id="pcc-history-btn"
            className={`pc-toolbar-btn ${showHistory ? "pc-active" : ""}`}
            onClick={() => {
              setShowHistory((s) => !s)
              if (!showHistory) loadConversations()
            }}
          >
            <MessageSquare size={11} />
            History
            {conversations.length > 0 && (
              <span style={{ marginLeft: 2, opacity: 0.6 }}>({conversations.length})</span>
            )}
          </button>
          {convId && (
            <span className="pc-conv-badge">
              #{convId.slice(-8)}
            </span>
          )}
        </div>

        {/* History dropdown */}
        {showHistory && (
          <div className="pc-history-dropdown">
            {histLoading ? (
              <div className="pc-hist-empty">
                <Loader2 size={14} style={{ animation: "spin 0.8s linear infinite", display: "inline" }} />
              </div>
            ) : conversations.length === 0 ? (
              <div className="pc-hist-empty">No chat history yet</div>
            ) : (
              conversations.map((c) => (
                <HistoryItem
                  key={c._id}
                  conv={c}
                  active={c._id === convId}
                  onSelect={selectConversation}
                  onDelete={deleteConversation}
                />
              ))
            )}
          </div>
        )}

        {/* Messages */}
        {messages.length === 0 && !isStreaming ? (
          <div className="pc-empty">
            <div className="pc-empty-icon">
              <Database size={22} />
            </div>
            <div className="pc-empty-title">Knowledge Base Chat</div>
            <div className="pc-empty-sub">
              Ask anything — I'll search the vector database first, then answer with Groq.
            </div>
            <div className="pc-chips">
              {[
                "What can you help me with?",
                "Summarize the knowledge base",
                "What documents are available?",
              ].map((q) => (
                <button
                  key={q}
                  className="pc-chip"
                  onClick={() => { setInput(q); textareaRef.current?.focus() }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pc-messages">
            {messages.map((msg, i) => (
              <ChatBubble key={msg.id || i} msg={msg} />
            ))}
            {isStreaming && (
              <TypingIndicator />
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Status bar */}
        {statusMsg && (
          <div className="pc-status-bar">
            <Loader2 size={11} style={{ animation: "spin 0.8s linear infinite" }} />
            {statusMsg}
          </div>
        )}

        {/* Footer */}
        <div className="pc-footer">
          <div className="pc-input-row">
            <textarea
              ref={textareaRef}
              id="pcc-query-input"
              className="pc-textarea"
              rows={1}
              placeholder="Ask the knowledge base…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                // auto-resize
                e.target.style.height = "auto"
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
              }}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />
            <button
              id="pcc-send-btn"
              className="pc-send-btn"
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              title="Send"
            >
              {isStreaming ? (
                <Loader2 size={16} style={{ animation: "spin 0.8s linear infinite" }} />
              ) : (
                <Send size={15} />
              )}
            </button>
          </div>
          <p className="pc-input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  )
}

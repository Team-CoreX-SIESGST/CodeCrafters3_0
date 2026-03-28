"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { SERVER_URL } from "@/utils/commonHelper"

const AUTO_SWIPE_MS = 10000
const SWIPE_THRESHOLD = 110
const SWIPE_OUT_DISTANCE = 520
const MAX_TITLE_LENGTH = 80
const MAX_SUMMARY_LENGTH = 200

const TYPE_ICONS = {
  news: "📰",
  skill: "🛠️",
  career: "💼",
  fact: "📊",
  goal: "🎯",
}

const LOCAL_FALLBACK_CARDS = [
  {
    id: "local-fallback-1",
    type: "news",
    title: "AI copilots are quietly reshaping how analysts work in 2025",
    summary: "Early adopters are pairing copilots with structured workflows to speed up research, with human review staying central to trust.",
    tags: ["AI", "automation", "analysis"],
    source: "RegIntel Brief",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.82,
    aiInsight: "",
  },
  {
    id: "local-fallback-2",
    type: "skill",
    title: "Skill stack: prompt design + systems thinking",
    summary: "Leaders in 2035 will blend AI prompt craft with cross-functional systems thinking to ship faster and safer.",
    tags: ["skill", "AI", "future"],
    source: "RegIntel Lab",
    imageUrl: null,
    readTime: "3 min",
    relevanceScore: 0.8,
    aiInsight: "",
  },
  {
    id: "local-fallback-3",
    type: "career",
    title: "Career signal: automation architects are trending",
    summary: "Companies are hiring hybrid builders who can pair automation with governance, bridging product, ops, and compliance.",
    tags: ["career", "automation", "governance"],
    source: "RegIntel Outlook",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.78,
    aiInsight: "",
  },
  {
    id: "local-fallback-4",
    type: "fact",
    title: "Future fact: data literacy is becoming a baseline",
    summary: "By 2030, most teams are expected to read dashboards and run simple analyses without a dedicated analyst.",
    tags: ["fact", "future", "career"],
    source: "RegIntel Signals",
    imageUrl: null,
    readTime: "1 min",
    relevanceScore: 0.76,
    aiInsight: "",
  },
  {
    id: "local-fallback-5",
    type: "goal",
    title: "Goal idea: build a personal automation backlog",
    summary: "Track repetitive work, estimate impact, and automate one workflow per quarter to compound time savings by 2035.",
    tags: ["goal", "automation", "productivity"],
    source: "RegIntel Studio",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.74,
    aiInsight: "",
  },
  {
    id: "local-fallback-6",
    type: "news",
    title: "Future skills employers keep listing in 2025 job posts",
    summary: "Signals point to AI-assisted workflows, data storytelling, and responsible automation as the top recurring themes.",
    tags: ["career", "skill", "AI"],
    source: "RegIntel Monitor",
    imageUrl: null,
    readTime: "3 min",
    relevanceScore: 0.79,
    aiInsight: "",
  },
  {
    id: "local-fallback-7",
    type: "career",
    title: "Career insight: compliance + AI is becoming a power combo",
    summary: "Hybrid roles blend policy fluency with automation skills, creating a fast lane for new leadership tracks.",
    tags: ["career", "AI", "governance"],
    source: "RegIntel Outlook",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.75,
    aiInsight: "",
  },
  {
    id: "local-fallback-8",
    type: "skill",
    title: "Skill refresh: narrative data storytelling",
    summary: "Future teams expect analysts to translate insights into clear narratives for executives and regulators.",
    tags: ["skill", "data", "career"],
    source: "RegIntel Lab",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.73,
    aiInsight: "",
  },
  {
    id: "local-fallback-9",
    type: "fact",
    title: "Fact check: automation is shifting teams, not replacing them",
    summary: "Organizations are redeploying people toward strategy and oversight rather than eliminating roles outright.",
    tags: ["fact", "automation", "future"],
    source: "RegIntel Signals",
    imageUrl: null,
    readTime: "1 min",
    relevanceScore: 0.72,
    aiInsight: "",
  },
  {
    id: "local-fallback-10",
    type: "goal",
    title: "Goal idea: build a 2035 learning map",
    summary: "Map the next 24 months of micro-credentials that ladder into an automation-first career path.",
    tags: ["goal", "skill", "future"],
    source: "RegIntel Studio",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.71,
    aiInsight: "",
  },
  {
    id: "local-fallback-11",
    type: "news",
    title: "Regulators are prioritizing AI transparency playbooks",
    summary: "Policy signals suggest organizations will need clearer audit trails for automated decisions by 2030.",
    tags: ["AI", "policy", "career"],
    source: "RegIntel Brief",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.77,
    aiInsight: "",
  },
  {
    id: "local-fallback-12",
    type: "skill",
    title: "Skill focus: low-code automation for ops teams",
    summary: "No-code workflows are becoming table stakes for analysts who want to scale process improvements.",
    tags: ["skill", "automation", "productivity"],
    source: "RegIntel Lab",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.74,
    aiInsight: "",
  },
  {
    id: "local-fallback-13",
    type: "fact",
    title: "Future fact: hybrid AI roles keep expanding",
    summary: "Roles that combine domain expertise and automation fluency are outpacing pure specialist roles.",
    tags: ["fact", "career", "AI"],
    source: "RegIntel Signals",
    imageUrl: null,
    readTime: "1 min",
    relevanceScore: 0.73,
    aiInsight: "",
  },
  {
    id: "local-fallback-14",
    type: "career",
    title: "Career watch: AI ethics operations leaders",
    summary: "Companies are staffing roles that bridge responsible AI, compliance, and product strategy.",
    tags: ["career", "AI", "governance"],
    source: "RegIntel Outlook",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.78,
    aiInsight: "",
  },
  {
    id: "local-fallback-15",
    type: "news",
    title: "Automation in logistics is accelerating faster than expected",
    summary: "Robotics pilots in supply chains are moving from trials to scaled deployments, reshaping operations work.",
    tags: ["automation", "robotics", "future"],
    source: "RegIntel Monitor",
    imageUrl: null,
    readTime: "3 min",
    relevanceScore: 0.76,
    aiInsight: "",
  },
  {
    id: "local-fallback-16",
    type: "news",
    title: "AI governance playbooks are becoming a board-level topic",
    summary: "Leaders are asking for clearer accountability models for automated decisions and model risk.",
    tags: ["AI", "governance", "career"],
    source: "RegIntel Brief",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.78,
    aiInsight: "",
  },
  {
    id: "local-fallback-17",
    type: "skill",
    title: "Skill signal: applied forecasting for policy teams",
    summary: "Scenario modeling and forecasting are becoming core for regulatory and strategy roles.",
    tags: ["skill", "future", "policy"],
    source: "RegIntel Lab",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.73,
    aiInsight: "",
  },
  {
    id: "local-fallback-18",
    type: "career",
    title: "Career pulse: AI risk analysts are in demand",
    summary: "Organizations are recruiting hybrid profiles that blend audit, data, and automation fluency.",
    tags: ["career", "AI", "automation"],
    source: "RegIntel Outlook",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.77,
    aiInsight: "",
  },
  {
    id: "local-fallback-19",
    type: "fact",
    title: "Future fact: operational resilience is tied to automation quality",
    summary: "Teams are linking reliability metrics with the quality of their automated workflows.",
    tags: ["fact", "automation", "future"],
    source: "RegIntel Signals",
    imageUrl: null,
    readTime: "1 min",
    relevanceScore: 0.72,
    aiInsight: "",
  },
  {
    id: "local-fallback-20",
    type: "goal",
    title: "Goal idea: build a weekly horizon scan ritual",
    summary: "Track 3 policy updates and 3 AI tools each week to stay ahead of the curve.",
    tags: ["goal", "career", "future"],
    source: "RegIntel Studio",
    imageUrl: null,
    readTime: "2 min",
    relevanceScore: 0.7,
    aiInsight: "",
  },
]

type FeedCard = {
  id: string
  type: "news" | "skill" | "career" | "fact" | "goal"
  title: string
  summary: string
  tags: string[]
  source: string
  imageUrl: string | null
  readTime: string
  relevanceScore: number
  aiInsight: string
}

type FeedPreferences = Record<string, number>

type ApiFeedResponse = {
  cards: FeedCard[]
  failedSources?: string[]
  fallbackCards?: FeedCard[]
}

function normalizeTitleKey(title: string) {
  return title.trim().toLowerCase()
}

function clampText(text: string, max: number) {
  if (!text) return ""
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function shuffleArray<T>(items: T[]) {
  const array = [...items]
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

function formatPreferenceKey(tag: string) {
  const lower = tag.trim().toLowerCase()
  if (!lower) return ""
  if (lower === "ai") return "AI"
  return lower
}

function loadPreferences(): FeedPreferences {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem("feedPreferences")
    if (!raw) {
      const initial = { AI: 0, career: 0, automation: 0 }
      window.localStorage.setItem("feedPreferences", JSON.stringify(initial))
      return initial
    }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      return parsed
    }
  } catch (_) {
    return { AI: 0, career: 0, automation: 0 }
  }
  return { AI: 0, career: 0, automation: 0 }
}

function scoreCard(card: FeedCard, preferences: FeedPreferences) {
  return card.tags.reduce((sum, tag) => {
    const key = formatPreferenceKey(tag)
    return sum + (preferences[key] || 0)
  }, 0)
}

function sortByPreferences(cards: FeedCard[], preferences: FeedPreferences) {
  const scored = cards.map((card, index) => ({
    card,
    index,
    score: scoreCard(card, preferences),
  }))
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.index - b.index
  })
  return scored.map((item) => item.card)
}

function sortQueuePreserveTop(cards: FeedCard[], preferences: FeedPreferences) {
  if (cards.length <= 1) return cards
  const [first, ...rest] = cards
  return [first, ...sortByPreferences(rest, preferences)]
}

function mergeUniqueCards(
  existing: FeedCard[],
  incoming: FeedCard[],
  seenTitles: Set<string>
) {
  const existingTitles = new Set(existing.map((card) => normalizeTitleKey(card.title)))
  const merged = [...existing]

  for (const card of incoming) {
    const key = normalizeTitleKey(card.title)
    if (!key || seenTitles.has(key) || existingTitles.has(key)) continue
    existingTitles.add(key)
    merged.push({
      ...card,
      title: clampText(card.title, MAX_TITLE_LENGTH),
      summary: clampText(card.summary, MAX_SUMMARY_LENGTH),
    })
  }

  return merged
}

function applyPreferenceDelta(
  preferences: FeedPreferences,
  tags: string[],
  delta: number
) {
  const next = { ...preferences }
  tags.forEach((tag) => {
    const key = formatPreferenceKey(tag)
    if (!key) return
    const current = Number.isFinite(next[key]) ? next[key] : 0
    const updated = current + delta
    next[key] = updated < 0 ? 0 : updated
  })
  return next
}

function buildInsightPrompt(card: FeedCard, preferences: FeedPreferences) {
  const topTags = Object.entries(preferences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag)

  const fallbackTags = topTags.length ? topTags : card.tags.slice(0, 3)

  return `The user is interested in: ${card.title}.\nTheir top interests are: ${fallbackTags.join(", ")}.\nGive a 2-sentence personalized insight about how this topic relates to their future in 2035. Be specific, motivating, and forward-looking. Max 60 words.`
}

function trimInsight(text: string) {
  if (!text) return ""
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)
  const twoSentences = sentences.slice(0, 2).join(" ")
  const words = twoSentences.split(/\s+/)
  if (words.length <= 60) return twoSentences
  return words.slice(0, 60).join(" ") + "…"
}

export default function FeedsPage() {
  const [cards, setCards] = useState<FeedCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [preferences, setPreferences] = useState<FeedPreferences>({})
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [swipeMode, setSwipeMode] = useState<"left" | "right" | "neutral" | null>(null)
  const [insightToast, setInsightToast] = useState<string | null>(null)
  const [isHolding, setIsHolding] = useState(false)
  const [autoProgress, setAutoProgress] = useState(0)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const seenTitlesRef = useRef<Set<string>>(new Set())
  const autoSwipeTickRef = useRef(0)

  const currentCard = cards[0]
  const nextCard = cards[1]

  const dragDirection = useMemo(() => {
    if (!isDragging) return null
    if (dragOffset.x > 24) return "right"
    if (dragOffset.x < -24) return "left"
    return null
  }, [dragOffset.x, isDragging])

  const fetchFeedBatch = useCallback(async () => {
    try {
      const response = await fetch("/api/feeds", { cache: "no-store" })
      if (!response.ok) throw new Error("Failed to load feed")
      const payload = (await response.json()) as ApiFeedResponse

      const fetchedCards = Array.isArray(payload.cards) ? payload.cards : []
      const fallbackCards = Array.isArray(payload.fallbackCards) ? payload.fallbackCards : []
      const includeFallback = (payload.failedSources?.length || 0) > 0

      const normalized = fetchedCards.map((card) => ({
        ...card,
        title: clampText(card.title, MAX_TITLE_LENGTH),
        summary: clampText(card.summary, MAX_SUMMARY_LENGTH),
      }))

      const deduped = shuffleArray(normalized).slice(0, 40)
      return {
        cards: deduped,
        fallbackCards: includeFallback ? fallbackCards : [],
      }
    } catch (error) {
      return {
        cards: [],
        fallbackCards: LOCAL_FALLBACK_CARDS,
      }
    }
  }, [])

  const hydrateInitialFeed = useCallback(async () => {
    setIsLoading(true)
    const stored = loadPreferences()
    setPreferences(stored)

    const { cards: fetchedCards, fallbackCards } = await fetchFeedBatch()
    const merged = mergeUniqueCards([], fetchedCards, seenTitlesRef.current)
    const fallback = mergeUniqueCards(merged, fallbackCards, seenTitlesRef.current)
    const finalCards = fallback.length ? fallback : mergeUniqueCards([], LOCAL_FALLBACK_CARDS, seenTitlesRef.current)

    const prioritized = sortByPreferences(finalCards, stored)
    setCards(prioritized)
    setIsLoading(false)
  }, [fetchFeedBatch])

  const prefetchMore = useCallback(async () => {
    if (isFetchingMore) return
    setIsFetchingMore(true)
    const { cards: fetchedCards, fallbackCards } = await fetchFeedBatch()
    setCards((prev) => {
      const merged = mergeUniqueCards(prev, fetchedCards, seenTitlesRef.current)
      const withFallback = mergeUniqueCards(merged, fallbackCards, seenTitlesRef.current)
      return sortQueuePreserveTop(withFallback, preferences)
    })
    setIsFetchingMore(false)
  }, [fetchFeedBatch, isFetchingMore, preferences])

  useEffect(() => {
    hydrateInitialFeed()
  }, [hydrateInitialFeed])

  useEffect(() => {
    if (cards.length < 10 && !isFetchingMore) {
      prefetchMore()
    }
  }, [cards.length, isFetchingMore, prefetchMore])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("feedPreferences", JSON.stringify(preferences))
    }
  }, [preferences])

  useEffect(() => {
    if (!cards.length || isDragging || isAnimating || isHolding) return
    const tick = autoSwipeTickRef.current + 1
    autoSwipeTickRef.current = tick
    const startedAt = Date.now()
    setAutoProgress(0)
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      setAutoProgress(Math.min(1, elapsed / AUTO_SWIPE_MS))
    }, 100)
    const timer = window.setTimeout(() => {
      if (autoSwipeTickRef.current !== tick) return
      handleSwipe("neutral")
    }, AUTO_SWIPE_MS)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(progressTimer)
    }
  }, [cards.length, isDragging, isAnimating, isHolding])

  useEffect(() => {
    if (!insightToast) return
    const timer = window.setTimeout(() => setInsightToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [insightToast])

  const resetDrag = () => {
    setDragOffset({ x: 0, y: 0 })
    setIsDragging(false)
    dragStartRef.current = null
    setSwipeMode(null)
  }

  const requestInsight = async (card: FeedCard, updated: FeedPreferences) => {
    const prompt = buildInsightPrompt(card, updated)
    try {
      const response = await fetch(`${SERVER_URL}/api/future-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      })
      if (!response.ok) throw new Error("AI request failed")
      const data = await response.json()
      const insight = trimInsight(data?.data?.response || data?.response || "")
      setInsightToast(insight || "Your future insight is on the way. Stay tuned.")
    } catch (error) {
      setInsightToast(card.aiInsight || "Your future insight is on the way. Stay tuned.")
    }
  }

  const updatePreferencesAndMaybeInsight = (
    direction: "left" | "right" | "neutral",
    card: FeedCard
  ) => {
    if (direction === "neutral") return preferences

    const delta = direction === "right" ? 1 : -1
    const updated = applyPreferenceDelta(preferences, card.tags, delta)
    setPreferences(updated)

    if (direction === "right") {
      void requestInsight(card, updated)
    }

    return updated
  }

  const completeSwipe = (direction: "left" | "right" | "neutral") => {
    if (!currentCard) return

    seenTitlesRef.current.add(normalizeTitleKey(currentCard.title))

    const updatedPreferences = updatePreferencesAndMaybeInsight(direction, currentCard)

    setCards((prev) => {
      const remaining = prev.slice(1)
      if (!remaining.length) return remaining
      return sortByPreferences(remaining, updatedPreferences || preferences)
    })

    resetDrag()
    setIsAnimating(false)
    setAutoProgress(0)
  }

  const handleSwipe = (direction: "left" | "right" | "neutral") => {
    if (!currentCard || isAnimating) return
    setIsAnimating(true)
    setSwipeMode(direction)

    const swipeX = direction === "left" ? -SWIPE_OUT_DISTANCE : direction === "right" ? SWIPE_OUT_DISTANCE : 0
    const swipeY = direction === "neutral" ? -140 : 0

    setDragOffset({ x: swipeX, y: swipeY })

    window.setTimeout(() => {
      completeSwipe(direction)
    }, 320)
  }

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!currentCard) return
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    setIsDragging(true)
    setIsHolding(true)
  }

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!isDragging || !dragStartRef.current) return
    const deltaX = event.clientX - dragStartRef.current.x
    const deltaY = event.clientY - dragStartRef.current.y
    setDragOffset({ x: deltaX, y: deltaY })
  }

  const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = () => {
    if (!isDragging) {
      setIsHolding(false)
      return
    }
    if (dragOffset.x > SWIPE_THRESHOLD) {
      handleSwipe("right")
    } else if (dragOffset.x < -SWIPE_THRESHOLD) {
      handleSwipe("left")
    } else {
      resetDrag()
    }
    setIsHolding(false)
  }

  const cardTransform = isAnimating
    ? `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x / 20}deg)`
    : `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x / 24}deg)`

  const overlayTint = dragDirection === "right" ? "bg-emerald-500/25" : dragDirection === "left" ? "bg-rose-500/25" : ""
  const overlayIcon = dragDirection === "right" ? "✓" : dragDirection === "left" ? "✗" : null
  const neutralIcon = swipeMode === "neutral" && isAnimating ? "⏭" : null

  return (
    <div className="min-h-[100dvh] w-full min-w-[375px] bg-[#0b0c12] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#5b7cff]/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 translate-x-1/3 rounded-full bg-[#c76843]/20 blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(12,15,30,0.9),rgba(10,12,20,0.98))]" />
        <div className="absolute inset-0 opacity-[0.2] [background-image:radial-gradient(#ffffff1a_1px,transparent_1px)] [background-size:24px_24px]" />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header className="px-4 pt-6 text-center">
          <div className="mx-auto inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.35em] text-white/70">
            Future Feed
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white">Swipe your 2035 signal</h1>
          <p className="mt-2 text-sm text-white/60">Right for more like this. Left to steer away. Hold to pause auto-swipe.</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-[0.7rem] text-white/55">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">AI + Career</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Live signals</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">2035-ready</span>
          </div>
        </header>

        <main className="relative flex flex-1 items-center justify-center px-4 pb-24 pt-6">
          <div className="relative w-full max-w-md">
            {isLoading && (
              <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_30px_80px_rgba(10,10,20,0.6)]">
                <Skeleton className="h-48 w-full rounded-2xl" />
                <div className="mt-6 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-14" />
                  </div>
                </div>
              </div>
            )}

            {!isLoading && nextCard && (
              <div className="absolute inset-0 translate-y-3 scale-[0.96] rounded-[28px] border border-white/10 bg-white/5 shadow-[0_20px_60px_rgba(10,10,20,0.4)]">
                <div className="h-full w-full overflow-hidden rounded-[28px]">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </div>
              </div>
            )}

            {!isLoading && currentCard && (
              <div
                className={cn(
                  "relative h-[calc(100dvh-230px)] min-h-[520px] max-h-[720px] w-full touch-none rounded-[28px] border border-white/15 bg-white/5 shadow-[0_30px_80px_rgba(10,10,20,0.6)] transition-transform duration-300",
                  isDragging ? "transition-none" : "",
                )}
                style={{ transform: cardTransform }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <div className="absolute inset-0 overflow-hidden rounded-[28px]">
                  {currentCard.imageUrl ? (
                    <img
                      src={currentCard.imageUrl}
                      alt={currentCard.title}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="h-full w-full bg-[radial-gradient(circle_at_top,#2a335f,#0b0c12_70%)]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                  {overlayTint && (
                    <div className={cn("absolute inset-0", overlayTint)} />
                  )}
                  {overlayIcon && (
                    <div className="absolute right-6 top-6 rounded-full border border-white/40 bg-white/20 px-4 py-2 text-2xl font-semibold text-white">
                      {overlayIcon}
                    </div>
                  )}
                  {neutralIcon && (
                    <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-white/40 bg-white/20 px-4 py-2 text-2xl font-semibold text-white">
                      {neutralIcon}
                    </div>
                  )}
                </div>

                <div className="relative z-10 flex h-full flex-col justify-between p-6">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/80">
                      {TYPE_ICONS[currentCard.type]} {currentCard.source}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70">
                      {currentCard.readTime}
                    </span>
                  </div>

                  <div className="space-y-4">
                    <h2 className="text-2xl font-semibold leading-snug text-white">{currentCard.title}</h2>
                    <p className="text-sm leading-relaxed text-white/75">{currentCard.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      {currentCard.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>Relevance {Math.round(currentCard.relevanceScore * 100)}%</span>
                    <span>{dragDirection ? "Release to swipe" : "Drag left or right"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        <div className="fixed inset-x-0 bottom-6 z-20 px-6">
          <div className="mx-auto flex max-w-md items-center justify-between rounded-full border border-white/10 bg-white/10 px-6 py-3 backdrop-blur-xl">
            <Button
              variant="ghost"
              size="icon-lg"
              className="h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20"
              onClick={() => handleSwipe("left")}
              aria-label="Skip"
            >
              ✗
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              className="h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20"
              onClick={() => handleSwipe("neutral")}
              aria-label="Save"
            >
              🔖
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              className="h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20"
              onClick={() => handleSwipe("right")}
              aria-label="Interested"
            >
              ✓
            </Button>
          </div>
          <div className="mt-3 text-center text-xs text-white/50">
            Auto-swipe in 10s (paused on hold)
          </div>
          <div className="mx-auto mt-2 h-1 w-full max-w-md overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 via-sky-400/80 to-purple-400/80 transition-[width] duration-100"
              style={{ width: `${Math.round(autoProgress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className={cn(
          "fixed inset-x-0 bottom-4 z-30 mx-auto flex max-w-md justify-center px-4 transition-all duration-300",
          insightToast ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0 pointer-events-none"
        )}
      >
        <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-sm text-white/90 shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {insightToast}
        </div>
      </div>
    </div>
  )
}

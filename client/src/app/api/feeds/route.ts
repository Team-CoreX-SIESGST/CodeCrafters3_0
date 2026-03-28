import { randomUUID } from "crypto"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const KEYWORDS = ["ai", "future", "career", "skill", "2025", "automation"]
const MAX_TITLE_LENGTH = 80
const MAX_SUMMARY_LENGTH = 200

const FALLBACK_CARDS = [
  {
    id: "fallback-1",
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
    id: "fallback-2",
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
    id: "fallback-3",
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
    id: "fallback-4",
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
    id: "fallback-5",
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
    id: "fallback-6",
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
    id: "fallback-7",
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
    id: "fallback-8",
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
    id: "fallback-9",
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
    id: "fallback-10",
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
    id: "fallback-11",
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
    id: "fallback-12",
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
    id: "fallback-13",
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
    id: "fallback-14",
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
    id: "fallback-15",
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
    id: "fallback-16",
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
    id: "fallback-17",
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

function clampText(text, max) {
  if (!text) return ""
  const clean = String(text).replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

function stripHtml(text) {
  if (!text) return ""
  return String(text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function normalizeTitle(title) {
  return String(title || "").trim()
}

function computeReadTime(text, fallback = 2) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean)
  if (!words.length) return `${fallback} min`
  const minutes = Math.max(1, Math.round(words.length / 180))
  return `${minutes} min`
}

function extractTags(text, extras = []) {
  const base = String(text || "").toLowerCase()
  const tags = new Set()
  if (base.includes("ai") || base.includes("artificial")) tags.add("AI")
  if (base.includes("future")) tags.add("future")
  if (base.includes("career")) tags.add("career")
  if (base.includes("skill")) tags.add("skill")
  if (base.includes("automation") || base.includes("automate")) tags.add("automation")
  if (base.includes("data")) tags.add("data")
  if (base.includes("robot")) tags.add("robotics")
  extras.forEach((tag) => {
    const cleaned = String(tag || "").trim()
    if (cleaned) tags.add(cleaned)
  })
  return Array.from(tags).slice(0, 6)
}

function inferType(text) {
  const base = String(text || "").toLowerCase()
  if (base.includes("career")) return "career"
  if (base.includes("skill")) return "skill"
  if (base.includes("goal")) return "goal"
  if (base.includes("fact")) return "fact"
  return "news"
}

function relevanceFromKeywords(text) {
  const base = String(text || "").toLowerCase()
  const hits = KEYWORDS.reduce((acc, word) => acc + (base.includes(word) ? 1 : 0), 0)
  return Math.min(0.98, 0.62 + hits * 0.07)
}

function safeImageUrl(url) {
  if (!url) return null
  const cleaned = String(url).replace(/&amp;/g, "&").trim()
  if (!cleaned.startsWith("http")) return null
  return cleaned
}

function dedupeByTitle(cards) {
  const seen = new Set()
  return cards.filter((card) => {
    const key = normalizeTitle(card.title).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json()
}

async function fetchHackerNews() {
  try {
    const ids = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json")
    const newIds = await fetchJson("https://hacker-news.firebaseio.com/v0/newstories.json")
    const combined = [
      ...(Array.isArray(ids) ? ids.slice(0, 30) : []),
      ...(Array.isArray(newIds) ? newIds.slice(0, 20) : []),
    ]
    const top = Array.from(new Set(combined)).slice(0, 40)
    const items = await Promise.allSettled(
      top.map((id) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
    )
    const filtered = items
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((item) => {
        const title = String(item?.title || "")
        return KEYWORDS.some((keyword) => title.toLowerCase().includes(keyword))
      })

    return filtered.map((item) => {
      const title = normalizeTitle(item?.title)
      const summary = clampText(item?.text || title, MAX_SUMMARY_LENGTH)
      return {
        id: item?.id ? String(item.id) : randomUUID(),
        type: inferType(title),
        title: clampText(title, MAX_TITLE_LENGTH),
        summary,
        tags: extractTags(title),
        source: "Hacker News",
        imageUrl: null,
        readTime: computeReadTime(summary),
        relevanceScore: relevanceFromKeywords(title),
        aiInsight: "",
      }
    })
  } catch (error) {
    return { error }
  }
}

async function fetchReddit(subreddit, limit) {
  try {
    const data = await fetchJson(`https://www.reddit.com/r/${subreddit}.json?limit=${limit}`,
      {
        headers: { "User-Agent": "RegIntelFeed/1.0" },
      }
    )
    const children = Array.isArray(data?.data?.children) ? data.data.children : []
    return children.map((child) => {
      const post = child?.data || {}
      const title = normalizeTitle(post.title)
      const summary = clampText(stripHtml(post.selftext || post.title), MAX_SUMMARY_LENGTH)
      const imageCandidate = post?.preview?.images?.[0]?.source?.url || post?.thumbnail
      const tags = extractTags(`${title} ${post.link_flair_text || ""}`, [subreddit])
      return {
        id: post?.id ? String(post.id) : randomUUID(),
        type: inferType(title),
        title: clampText(title, MAX_TITLE_LENGTH),
        summary,
        tags,
        source: `Reddit / r/${subreddit}`,
        imageUrl: safeImageUrl(imageCandidate),
        readTime: computeReadTime(summary),
        relevanceScore: relevanceFromKeywords(title),
        aiInsight: "",
      }
    })
  } catch (error) {
    return { error }
  }
}

async function fetchDevTo(tag, perPage) {
  try {
    const data = await fetchJson(`https://dev.to/api/articles?tag=${tag}&per_page=${perPage}`)
    const articles = Array.isArray(data) ? data : []
    return articles.map((article) => {
      const title = normalizeTitle(article?.title)
      const summary = clampText(stripHtml(article?.description || article?.title), MAX_SUMMARY_LENGTH)
      const tags = extractTags(`${title} ${article?.tag_list?.join(" ") || ""}`, article?.tag_list || [])
      return {
        id: article?.id ? String(article.id) : randomUUID(),
        type: inferType(title),
        title: clampText(title, MAX_TITLE_LENGTH),
        summary,
        tags,
        source: "Dev.to",
        imageUrl: safeImageUrl(article?.cover_image || article?.social_image),
        readTime: article?.reading_time_minutes ? `${article.reading_time_minutes} min` : computeReadTime(summary),
        relevanceScore: relevanceFromKeywords(title),
        aiInsight: "",
      }
    })
  } catch (error) {
    return { error }
  }
}

async function fetchNewsApi() {
  try {
    const apiKey = process.env.NEWS_API_KEY
    if (!apiKey) {
      throw new Error("NEWS_API_KEY not configured")
    }
    const url = `https://newsapi.org/v2/everything?q=future+skills+2035&pageSize=20&apiKey=${apiKey}`
    const data = await fetchJson(url)
    const articles = Array.isArray(data?.articles) ? data.articles : []
    return articles.map((article) => {
      const title = normalizeTitle(article?.title)
      const summary = clampText(stripHtml(article?.description || article?.content || title), MAX_SUMMARY_LENGTH)
      const sourceName = article?.source?.name || "NewsAPI"
      return {
        id: article?.url ? String(article.url) : randomUUID(),
        type: inferType(title),
        title: clampText(title, MAX_TITLE_LENGTH),
        summary,
        tags: extractTags(`${title} ${sourceName}`),
        source: sourceName,
        imageUrl: safeImageUrl(article?.urlToImage),
        readTime: computeReadTime(summary),
        relevanceScore: relevanceFromKeywords(title),
        aiInsight: "",
      }
    })
  } catch (error) {
    return { error }
  }
}

export async function GET() {
  const failedSources = []

  const hnResult = await fetchHackerNews()
  let hackerNewsCards = []
  if (Array.isArray(hnResult)) {
    hackerNewsCards = hnResult
  } else {
    failedSources.push("hackernews")
  }

  const redditResults = await Promise.all([
    fetchReddit("Futurology", 20),
    fetchReddit("careerguidance", 20),
    fetchReddit("learnprogramming", 10),
  ])

  const redditCards = []
  redditResults.forEach((result, index) => {
    if (Array.isArray(result)) {
      redditCards.push(...result)
    } else {
      failedSources.push(index === 0 ? "reddit-futurology" : index === 1 ? "reddit-careerguidance" : "reddit-learnprogramming")
    }
  })

  const devToResults = await Promise.all([
    fetchDevTo("career", 20),
    fetchDevTo("ai", 20),
  ])

  const devToCards = []
  devToResults.forEach((result, index) => {
    if (Array.isArray(result)) {
      devToCards.push(...result)
    } else {
      failedSources.push(index === 0 ? "devto-career" : "devto-ai")
    }
  })

  const newsApiResult = await fetchNewsApi()
  const newsApiCards = Array.isArray(newsApiResult) ? newsApiResult : []
  if (!Array.isArray(newsApiResult)) {
    failedSources.push("newsapi")
  }

  const merged = dedupeByTitle([
    ...hackerNewsCards,
    ...redditCards,
    ...devToCards,
    ...newsApiCards,
  ])

  const cards = merged.length ? merged : FALLBACK_CARDS

  return NextResponse.json({
    cards,
    failedSources,
    fallbackCards: failedSources.length > 0 ? FALLBACK_CARDS : [],
  })
}

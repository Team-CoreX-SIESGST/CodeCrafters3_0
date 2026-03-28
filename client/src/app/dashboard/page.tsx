'use client';

import { type ReactNode, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Database,
  Network,
  RefreshCw,
  Server,
  TimerReset,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AnalyticsNodeGraph from "@/components/dashboard/AnalyticsNodeGraph";
import { SERVER_URL } from "@/utils/commonHelper";

const DASHBOARD_URL = `${SERVER_URL}/api/cognitive/dashboard`;

type GraphNode = {
  id: string;
  label: string;
  type: string;
  updatedAt?: string | null;
  source?: "db" | "live" | "both";
  degree?: number;
};
type GraphLink = {
  source: string;
  target: string;
  label: string;
  updatedAt?: string | null;
  sourceKind?: "db" | "live" | "both";
};
type BreakdownApp = {
  app: string;
  count: number;
  share: number;
  avgFocus: number;
  avgConfusion: number;
  avgFatigue: number;
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  source: {
    mongoConnected: boolean;
    liveConnected: boolean;
    liveUrl: string;
    liveError: string | null;
    analyticsSource: string;
    analyticsUserId: string | null;
  };
  summary: {
    snapshotCount: number;
    latestGeneratedAt: string | null;
    latestState: string;
    topState: string;
    avgFocusDepth: number;
    avgConfusionRisk: number;
    avgFatigueRisk: number;
    avgInterruptibility: number;
  };
  live: {
    current: {
      generatedAt?: string | null;
      stateLabel?: string;
      classifierState?: string;
      confidence?: number;
      message?: string;
      activeApp?: string;
      activeWindow?: string;
      blinkRate?: number | null;
      perclos?: number | null;
      expression?: string;
      idleSeconds?: number | null;
      scores?: Record<string, number>;
      mlState?: { state_label?: string; confidence?: number } | null;
      detectionSource?: string;
      onnx?: { ready?: boolean; predicted_state?: string; confusion_prob?: number; fatigue_prob?: number } | null;
      timeTracker?: { top_apps?: { app: string; seconds: number; share?: number }[] } | null;
    } | null;
    graph: {
      nodes: GraphNode[];
      links: GraphLink[];
      stats: {
        nodeCount: number;
        relationCount: number;
        nodeTypes: Record<string, number>;
        nodeSources?: Record<string, number>;
        relationSources?: Record<string, number>;
        dbNodeCount?: number;
        liveNodeCount?: number;
        dbRelationCount?: number;
        liveRelationCount?: number;
      };
    };
  };
  analytics: {
    stateDistribution: Array<{ label: string; count: number; percentage: number }>;
    scoreTimeline: Array<{ timestamp: string | null; focusDepth: number; confusionRisk: number; fatigueRisk: number }>;
    appBreakdown: BreakdownApp[];
    alertTotals: {
      attentionResidue: number;
      preError: number;
      fatigue: number;
      confusionEpisodes: number;
      handoffCapsules: number;
    };
    frictionHotspots: Array<{
      artifactId: string;
      artifactLabel: string;
      frictionScore: number;
      visits: number;
      revisits: number;
    }>;
    recentEvents: Array<{ id: string; createdAt: string | null; message: string; timestamp: string }>;
    confusionEpisodes: Array<{
      episodeId: string;
      status: string;
      peakConfusion: number;
      durationS: number | null;
      activeApp: string;
      startedAt: string | null;
    }>;
    insights: string[];
  };
};

const percent = (v?: number | null) => `${Math.round((Number(v) || 0) * 100)}%`;
const compactPercent = (v?: number | null) => `${Math.round(Number(v) || 0)}%`;
const pretty = (v?: string | null) => (v || "unknown").replace(/_/g, " ");
const scoreClass = (v?: number | null) =>
  (Number(v) || 0) >= 0.7 ? "text-emerald-300" : (Number(v) || 0) >= 0.45 ? "text-amber-300" : "text-slate-200";

/* ── KPI stat card ────────────────────────────────────────────────── */
function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
      <div className="mb-3 flex items-center justify-between text-slate-300">
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 p-2 text-emerald-300">{icon}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm text-slate-400">{hint}</div>
    </div>
  );
}

/* ── panel wrapper ───────────────────────────────────────────────── */
function Panel({
  title,
  eyebrow,
  children,
  aside,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  aside?: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#08111a]/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,178,123,0.12),transparent_35%),radial-gradient(circle_at_left,rgba(106,169,255,0.1),transparent_30%)]" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-emerald-300/80">{eyebrow}</div>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        {aside ? <div className="text-xs text-slate-400">{aside}</div> : null}
      </div>
      <div className="relative mt-5">{children}</div>
    </section>
  );
}

/* ── score bar ───────────────────────────────────────────────────── */
function ScoreBar({ label, value, gradient }: { label: string; value: number; gradient: string }) {
  const width = `${Math.max(5, Math.round(value * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
        <span className="capitalize">{label}</span>
        <span className={scoreClass(value)}>{percent(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/6">
        <div className="h-2 rounded-full transition-all duration-700" style={{ width, background: gradient }} />
      </div>
    </div>
  );
}

/* ── mini bar column for timeline histogram ──────────────────────── */
function TimelineBar({
  point,
  index,
}: {
  point: { timestamp: string | null; focusDepth: number; confusionRisk: number; fatigueRisk: number };
  index: number;
}) {
  return (
    <div key={`${point.timestamp || index}`} className="flex h-full flex-col justify-end gap-[2px]">
      <div
        className="rounded-t-full bg-gradient-to-t from-emerald-500 to-emerald-300"
        style={{ height: `${Math.max(10, point.focusDepth * 100)}%` }}
        title={`Focus: ${Math.round(point.focusDepth * 100)}%`}
      />
      <div
        className="rounded-t-full bg-gradient-to-t from-amber-500 to-amber-300/80"
        style={{ height: `${Math.max(6, point.confusionRisk * 85)}%` }}
        title={`Confusion: ${Math.round(point.confusionRisk * 100)}%`}
      />
      <div
        className="rounded-t-full bg-gradient-to-t from-cyan-500 to-cyan-300/80"
        style={{ height: `${Math.max(6, point.fatigueRisk * 85)}%` }}
        title={`Fatigue: ${Math.round(point.fatigueRisk * 100)}%`}
      />
    </div>
  );
}

/* ── state donut segment (simple arc segments) ───────────────────── */
const STATE_PALETTE = [
  "rgba(0,232,122,0.85)",
  "rgba(106,169,255,0.85)",
  "rgba(245,158,11,0.85)",
  "rgba(239,68,68,0.85)",
  "rgba(34,211,238,0.85)",
  "rgba(167,139,250,0.85)",
];

/* ── main page ───────────────────────────────────────────────────── */
export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async (background = false) => {
      if (!background) setLoading(true);
      if (background) setRefreshing(true);
      try {
        const response = await fetch(DASHBOARD_URL, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message || "Unable to load dashboard.");
        if (active) { setData(payload); setError(null); }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        if (active) { setLoading(false); setRefreshing(false); }
      }
    };
    load();
    return () => { active = false; };
  }, [reloadNonce]);

  const current = data?.live.current;
  const scores = current?.scores || {};
  const timeline = data?.analytics.scoreTimeline.slice(-20) || [];
  const workloadMix = data?.analytics.appBreakdown || [];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#05090f_0%,#0a1219_45%,#081018_100%)] text-white">
      <Navbar />
      <main className="mx-auto max-w-7xl px-6 pb-16 pt-28">

        {/* ── header ─────────────────────────────────────────────── */}
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.36em] text-emerald-300/80">
              Overall DB analytics
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Cognitive Dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Graphs, scores, and distributions computed from the full dataset stored in MongoDB.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-emerald-300">
              {data?.source.analyticsSource || "loading"}
            </span>
            <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.24em] text-sky-300">
              db only
            </span>
            <button
              type="button"
              onClick={() => setReloadNonce((v) => v + 1)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-slate-300">
            Loading dashboard data from MongoDB…
          </div>
        ) : error ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 p-8 text-red-100">{error}</div>
        ) : !data ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-slate-300">
            No dashboard payload available.
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── row 1: KPI cards ─────────────────────────────────── */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={<Brain className="h-4 w-4" />}
                label="Top State"
                value={pretty(data.summary.topState || data.summary.latestState)}
                hint={`${data.summary.snapshotCount} snapshots total`}
              />
              <StatCard
                icon={<Activity className="h-4 w-4" />}
                label="Avg Focus"
                value={percent(data.summary.avgFocusDepth)}
                hint={`avg confusion ${percent(data.summary.avgConfusionRisk)}`}
              />
              <StatCard
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Avg Fatigue"
                value={percent(data.summary.avgFatigueRisk)}
                hint={`avg interruptibility ${percent(data.summary.avgInterruptibility)}`}
              />
              <StatCard
                icon={<Network className="h-4 w-4" />}
                label="Graph"
                value={`${data.live.graph.stats.nodeCount} nodes`}
                hint={`${data.live.graph.stats.relationCount} db relations`}
              />
            </div>

            {/* ── row 2: orbital node graph + score rails ──────────── */}
            <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
              <Panel
                eyebrow="Neo4j DB context"
                title="Observer graph"
                aside={`${data.live.graph.stats.nodeCount} nodes / ${data.live.graph.stats.relationCount} links`}
              >
                <AnalyticsNodeGraph
                  nodes={data.live.graph.nodes}
                  links={data.live.graph.links}
                  height={480}
                />
                {/* graph legend/stats */}
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {[
                    ["db nodes", data.live.graph.stats.dbNodeCount ?? 0],
                    ["snapshots", data.summary.snapshotCount],
                    ["db links", data.live.graph.stats.dbRelationCount ?? 0],
                    ["state types", Object.keys(data.live.graph.stats.nodeTypes || {}).length],
                    ["total nodes", data.live.graph.stats.nodeCount],
                    ["total links", data.live.graph.stats.relationCount],
                  ].map(([label, count]) => (
                    <div key={String(label)} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">{label}</div>
                      <div className="mt-1 text-xl font-semibold text-white">{count}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* avg score bars */}
              <Panel eyebrow="DB averages" title="Cognitive score rails">
                <div className="space-y-5">
                  <ScoreBar
                    label="focus depth"
                    value={scores.focus_depth ?? data.summary.avgFocusDepth}
                    gradient="linear-gradient(90deg,#34b27b,#6aa9ff)"
                  />
                  <ScoreBar
                    label="confusion risk"
                    value={scores.confusion_risk ?? data.summary.avgConfusionRisk}
                    gradient="linear-gradient(90deg,#f59e0b,#ef4444)"
                  />
                  <ScoreBar
                    label="fatigue risk"
                    value={scores.fatigue_risk ?? data.summary.avgFatigueRisk}
                    gradient="linear-gradient(90deg,#22d3ee,#f59e0b)"
                  />
                  <ScoreBar
                    label="interruptibility"
                    value={scores.interruptibility ?? data.summary.avgInterruptibility}
                    gradient="linear-gradient(90deg,#8b5cf6,#6aa9ff)"
                  />
                  <ScoreBar
                    label="attention residue"
                    value={scores.attention_residue ?? 0}
                    gradient="linear-gradient(90deg,#fbbf24,#f87171)"
                  />
                </div>

                {/* alert totals grid */}
                <div className="mt-6 grid gap-3 grid-cols-2">
                  {[
                    { label: "Residue", value: data.analytics.alertTotals.attentionResidue, Icon: TimerReset },
                    { label: "Pre-error", value: data.analytics.alertTotals.preError, Icon: AlertTriangle },
                    { label: "Fatigue alerts", value: data.analytics.alertTotals.fatigue, Icon: Brain },
                    { label: "Confusion eps.", value: data.analytics.alertTotals.confusionEpisodes, Icon: Activity },
                    { label: "Handoffs", value: data.analytics.alertTotals.handoffCapsules, Icon: Database },
                    { label: "Snapshots", value: data.summary.snapshotCount, Icon: Server },
                  ].map(({ label, value, Icon }) => (
                    <div key={label} className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                      <div className="flex items-center justify-between text-slate-400">
                        <span><Icon className="h-4 w-4" /></span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.22em]">{label}</span>
                      </div>
                      <div className="mt-3 text-2xl font-semibold text-white">{value as number}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* ── row 3: timeline histogram + state distribution ────── */}
            <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
              <Panel
                eyebrow="Signal timeline"
                title="Score movement over time"
                aside={`${timeline.length} windows`}
              >
                {/* legend */}
                <div className="mb-3 flex gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-emerald-400" />Focus</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-amber-400" />Confusion</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full bg-cyan-400" />Fatigue</span>
                </div>
                <div
                  className="grid items-end gap-1"
                  style={{
                    height: 280,
                    gridTemplateColumns: `repeat(${timeline.length || 1}, minmax(0, 1fr))`,
                  }}
                >
                  {timeline.map((point, i) => (
                    <TimelineBar key={`${point.timestamp || i}`} point={point} index={i} />
                  ))}
                </div>
              </Panel>

              <Panel eyebrow="State distribution" title="DB state split">
                <div className="space-y-4">
                  {data.analytics.stateDistribution.slice(0, 7).map((state, i) => (
                    <div key={state.label}>
                      <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
                        <span>{pretty(state.label)}</span>
                        <span style={{ color: STATE_PALETTE[i % STATE_PALETTE.length] }}>
                          {state.percentage}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/6">
                        <div
                          className="h-2 rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.max(6, state.percentage)}%`,
                            background: STATE_PALETTE[i % STATE_PALETTE.length],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* node type breakdown */}
                <div className="mt-5 pt-4 border-t border-white/8">
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
                    Node types
                  </div>
                  <div className="grid gap-2 grid-cols-2">
                    {Object.entries(data.live.graph.stats.nodeTypes || {}).slice(0, 6).map(([type, count]) => (
                      <div key={type} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                        <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-slate-500">{type}</div>
                        <div className="mt-0.5 text-lg font-semibold text-white">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Panel>
            </div>

            {/* ── row 4: app workload mix + friction hotspots ────────── */}
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel eyebrow="App distribution" title="DB workload mix">
                <div className="space-y-3">
                  {workloadMix.slice(0, 8).map((app, i) => {
                    const share = Math.round(app.share || 0);
                    return (
                      <div key={`${app.app}-${i}`}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="text-white">{app.app}</span>
                          <span className="text-slate-300">{share}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/6">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${Math.max(8, share)}%`,
                              background: "linear-gradient(90deg,#34b27b,#22d3ee)",
                            }}
                          />
                        </div>
                        {/* mini sub-stats */}
                        <div className="mt-1 flex gap-3 text-[10px] text-slate-500">
                          <span>focus {Math.round(app.avgFocus * 100)}%</span>
                          <span>confusion {Math.round(app.avgConfusion * 100)}%</span>
                          <span>fatigue {Math.round(app.avgFatigue * 100)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel eyebrow="Friction analysis" title="Hotspot scoring">
                <div className="space-y-3">
                  {data.analytics.frictionHotspots.length === 0 ? (
                    <div className="text-sm text-slate-500 italic">No friction hotspots recorded.</div>
                  ) : (
                    data.analytics.frictionHotspots.slice(0, 7).map((spot) => {
                      const score = Math.round(spot.frictionScore * 100);
                      return (
                        <div key={spot.artifactId || spot.artifactLabel}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="text-white">{spot.artifactLabel}</span>
                            <span className="text-amber-300">{score}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/6">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${Math.max(6, score)}%`,
                                background: "linear-gradient(90deg,#fbbf24,#f87171)",
                              }}
                            />
                          </div>
                          <div className="mt-1 flex gap-3 text-[10px] text-slate-500">
                            <span>visits {spot.visits}</span>
                            <span>revisits {spot.revisits}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Panel>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

'use client';

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Brain,
  Database,
  Network,
  RefreshCw,
  Server,
  TimerReset,
  Zap,
  TrendingUp,
  Eye,
  Cpu,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AnalyticsNodeGraph from "@/components/dashboard/AnalyticsNodeGraph";
import DashboardLoadingSplash from "@/components/dashboard/DashboardLoadingSplash";
import { SERVER_URL } from "@/utils/commonHelper";

const DASHBOARD_URL = `${SERVER_URL}/api/cognitive/dashboard`;

/* ── minimal types ──────────────────────────────────────────────────────── */
type ScoreAvg = { key: string; label: string; value: number };
type TimelinePoint = {
  timestamp: string | null;
  stateLabel: string;
  focusDepth: number;
  confusionRisk: number;
  fatigueRisk: number;
  interruptibility: number;
};
type StatePoint = { label: string; count: number; percentage: number };
type Transition = { from: string; to: string; count: number };
type AppEntry = { app: string; count: number; share: number; avgFocus: number; avgConfusion: number; avgFatigue: number };
type HotSpot = { artifactId: string; artifactLabel: string; frictionScore: number; visits: number; revisits: number };
type GraphNode = { id: string; label: string; type: string; source?: string; degree?: number };
type GraphLink = { source: string; target: string; label: string; sourceKind?: string };

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  source: { mongoConnected: boolean; analyticsSource: string; analyticsUserId: string | null };
  summary: {
    snapshotCount: number;
    latestState: string;
    topState: string;
    avgFocusDepth: number;
    avgConfusionRisk: number;
    avgFatigueRisk: number;
    avgInterruptibility: number;
    deepFocusRate: number;
    harmfulConfusionRate: number;
    fatigueRate: number;
  };
  live: {
    current: {
      stateLabel?: string;
      confidence?: number;
      activeApp?: string;
      scores?: Record<string, number>;
      onnx?: { ready?: boolean; predicted_state?: string; confusion_prob?: number; fatigue_prob?: number } | null;
    } | null;
    graph: { nodes: GraphNode[]; links: GraphLink[]; stats: { nodeCount: number; relationCount: number; nodeTypes: Record<string, number>; dbNodeCount?: number; dbRelationCount?: number } };
  };
  analytics: {
    scoreAverages: ScoreAvg[];
    scoreTimeline: TimelinePoint[];
    stateDistribution: StatePoint[];
    stateTransitions: Transition[];
    appBreakdown: AppEntry[];
    scoreExtremes: { highestFocus: TimelinePoint | null; highestConfusion: TimelinePoint | null; highestFatigue: TimelinePoint | null };
    alertTotals: { attentionResidue: number; preError: number; fatigue: number; confusionEpisodes: number; handoffCapsules: number };
    frictionHotspots: HotSpot[];
  };
};

/* ── helpers ─────────────────────────────────────────────────────────────── */
const pct = (v?: number | null) => `${Math.round((Number(v) || 0) * 100)}%`;
const pretty = (v?: string | null) => (v || "—").replace(/_/g, " ");
const clr = (v: number) => v >= 0.65 ? "#34b27b" : v >= 0.4 ? "#f59e0b" : "#ef4444";
const focusClr = (v: number) => v >= 0.65 ? "#34b27b" : v >= 0.4 ? "#f59e0b" : "#6aa9ff";

const STATE_PALETTE = ["#34b27b","#6aa9ff","#f59e0b","#ef4444","#22d3ee","#a78bfa","#fb7185","#fbbf24"];

/* ── tiny sub-components ─────────────────────────────────────────────────── */
function Panel({ eyebrow, title, children, aside }: { eyebrow: string; title: string; children: ReactNode; aside?: string }) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#08111a]/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,178,123,0.1),transparent_35%),radial-gradient(circle_at_left,rgba(106,169,255,0.08),transparent_30%)]" />
      <div className="relative flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.34em] text-emerald-300/70">{eyebrow}</div>
          <h2 className="mt-1.5 text-lg font-semibold text-white">{title}</h2>
        </div>
        {aside && <div className="text-xs text-slate-400 font-mono">{aside}</div>}
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

function KpiCard({ icon, label, value, sub, color = "#34b27b" }: { icon: ReactNode; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full border p-2" style={{ borderColor: `${color}40`, background: `${color}18`, color }}>{icon}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function HBar({ value, max = 1, color = "#34b27b", height = "h-2" }: { value: number; max?: number; color?: string; height?: string }) {
  const w = Math.max(3, Math.min(100, (value / max) * 100));
  return (
    <div className={`${height} w-full rounded-full bg-white/6 overflow-hidden`}>
      <div className={`${height} rounded-full transition-all duration-700`} style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/* ── Score averages radar-style bars ─────────────────────────────────────── */
function ScoreAverageBars({ averages }: { averages: ScoreAvg[] }) {
  const SCORE_COLORS: Record<string, string> = {
    focus_depth:        "#34b27b",
    attention_residue:  "#fbbf24",
    pre_error_risk:     "#f87171",
    confusion_risk:     "#ef4444",
    fatigue_risk:       "#f59e0b",
    interruptibility:   "#6aa9ff",
  };
  return (
    <div className="space-y-4">
      {averages.map((s) => (
        <div key={s.key}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-slate-300">{s.label}</span>
            <span className="font-mono font-semibold" style={{ color: SCORE_COLORS[s.key] || "#94a3b8" }}>{pct(s.value)}</span>
          </div>
          <HBar value={s.value} color={SCORE_COLORS[s.key] || "#94a3b8"} />
        </div>
      ))}
    </div>
  );
}

/* ── State distribution bars ─────────────────────────────────────────────── */
function StateDistBars({ distribution }: { distribution: StatePoint[] }) {
  return (
    <div className="space-y-3">
      {distribution.slice(0, 7).map((s, i) => (
        <div key={s.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-slate-300 capitalize">{pretty(s.label)}</span>
            <span className="font-mono text-xs" style={{ color: STATE_PALETTE[i % STATE_PALETTE.length] }}>{s.percentage}% <span className="text-slate-500">({s.count})</span></span>
          </div>
          <HBar value={s.percentage} max={100} color={STATE_PALETTE[i % STATE_PALETTE.length]} />
        </div>
      ))}
    </div>
  );
}

/* ── State transition matrix ─────────────────────────────────────────────── */
function TransitionTable({ transitions }: { transitions: Transition[] }) {
  const maxCount = Math.max(...transitions.map((t) => t.count), 1);
  return (
    <div className="space-y-2">
      {transitions.slice(0, 8).map((t, i) => (
        <div key={`${t.from}-${t.to}-${i}`} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs mb-1">
              <span className="text-emerald-300/80 font-mono truncate">{pretty(t.from)}</span>
              <span className="text-slate-500">→</span>
              <span className="text-sky-300/80 font-mono truncate">{pretty(t.to)}</span>
            </div>
            <HBar value={t.count} max={maxCount} color="#6aa9ff" height="h-1.5" />
          </div>
          <span className="text-white font-semibold text-sm w-6 text-right shrink-0">{t.count}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Animated SVG signal line chart ─────────────────────────────────────── */
const SIGNALS = [
  { field: "focusDepth"       as const, label: "Focus",           stroke: "#34b27b", fill: "url(#g-focus)"   , id: "g-focus"    },
  { field: "confusionRisk"    as const, label: "Confusion",        stroke: "#ef4444", fill: "url(#g-conf)"    , id: "g-conf"     },
  { field: "fatigueRisk"      as const, label: "Fatigue",           stroke: "#f59e0b", fill: "url(#g-fat)"     , id: "g-fat"      },
  { field: "interruptibility" as const, label: "Interruptibility",  stroke: "#a78bfa", fill: "url(#g-inter)"   , id: "g-inter"    },
] as const;

function SignalTimeline({ timeline }: { timeline: TimelinePoint[] }) {
  const [drawn, setDrawn] = useState(false);
  const W = 900, H = 260, PAD = { top: 18, right: 18, bottom: 28, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;
  const n = timeline.length;

  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t); }, [timeline.length]);

  if (!n) return <div className="h-64 flex items-center justify-center text-slate-500 text-sm italic">No timeline data yet.</div>;

  const xOf = (i: number) => PAD.left + (i / Math.max(n - 1, 1)) * innerW;
  const yOf = (v: number) => PAD.top  + (1 - Math.max(0, Math.min(1, v))) * innerH;

  /* bezier smooth path */
  const bezierPath = (vals: number[]) => {
    const pts = vals.map((v, i) => [xOf(i), yOf(v)] as [number, number]);
    if (pts.length < 2) return ``;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1][0] + pts[i][0]) / 2;
      d += ` C ${cpx} ${pts[i - 1][1]}, ${cpx} ${pts[i][1]}, ${pts[i][0]} ${pts[i][1]}`;
    }
    return d;
  };

  /* grid lines (horizontal) */
  const gridVals = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <div>
      {/* legend */}
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-400">
        {SIGNALS.map((sig) => (
          <span key={sig.id} className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: sig.stroke }} />
            {sig.label}
          </span>
        ))}
      </div>

      {/* chart */}
      <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#02080e]">
        {/* scanline overlay */}
        <div className="pointer-events-none absolute inset-0 z-10"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.06) 3px,rgba(0,0,0,0.06) 4px)" }} />
        {/* glow */}
        <div className="pointer-events-none absolute inset-0 z-0"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 100%,rgba(52,178,123,0.08),transparent)" }} />

        <svg viewBox={`0 0 ${W} ${H}`} className="relative z-[1] w-full" style={{ height: 260 }}>
          <defs>
            {SIGNALS.map((sig) => (
              <linearGradient key={sig.id} id={sig.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={sig.stroke} stopOpacity="0.32" />
                <stop offset="100%" stopColor={sig.stroke} stopOpacity="0" />
              </linearGradient>
            ))}
            <filter id="glow-line">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* grid */}
          {gridVals.map((gv) => {
            const gy = yOf(gv);
            return (
              <g key={gv}>
                <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 6" />
                <text x={PAD.left - 6} y={gy + 3.5} textAnchor="end"
                  fontSize="9" fill="rgba(148,163,184,0.5)" fontFamily="IBM Plex Mono, monospace">
                  {Math.round(gv * 100)}
                </text>
              </g>
            );
          })}

          {/* vertical time ticks every ~4 points */}
          {timeline.filter((_, i) => i % Math.max(1, Math.floor(n / 8)) === 0).map((p, i) => {
            const idx = i * Math.max(1, Math.floor(n / 8));
            const tx = xOf(idx);
            return (
              <g key={`xt-${i}`}>
                <line x1={tx} y1={PAD.top} x2={tx} y2={H - PAD.bottom}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              </g>
            );
          })}

          {/* filled area + line per signal */}
          {[...SIGNALS].reverse().map((sig) => {
            const vals = timeline.map((p) => p[sig.field]);
            const linePath = bezierPath(vals);
            const lastX = xOf(n - 1);
            const areaPath = linePath + ` L ${lastX} ${yOf(0)} L ${xOf(0)} ${yOf(0)} Z`;
            /* animate via initial long dasharray trick */
            const approxLen = 2200;
            return (
              <g key={sig.id}>
                {/* area fill */}
                <path d={areaPath} fill={sig.fill} />
                {/* glow copy */}
                <path d={linePath} fill="none" stroke={sig.stroke} strokeWidth="3"
                  strokeOpacity="0.25" filter="url(#glow-line)"
                  strokeDasharray={approxLen}
                  strokeDashoffset={drawn ? 0 : approxLen}
                  style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)" }} />
                {/* main line */}
                <path d={linePath} fill="none" stroke={sig.stroke} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={approxLen}
                  strokeDashoffset={drawn ? 0 : approxLen}
                  style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)" }} />
              </g>
            );
          })}

          {/* dot markers at each point for the primary signal (focus) */}
          {timeline.map((p, i) => (
            <circle key={`dot-${i}`}
              cx={xOf(i)} cy={yOf(p.focusDepth)} r="2.5"
              fill="#34b27b" fillOpacity={drawn ? 0.9 : 0}
              style={{ transition: `fill-opacity 0.4s ease ${0.08 * i}s` }}
            />
          ))}

          {/* state-label strip at very bottom */}
          {timeline.filter((_, i) => i % Math.max(1, Math.floor(n / 6)) === 0).map((p, i) => {
            const idx = i * Math.max(1, Math.floor(n / 6));
            return (
              <text key={`sl-${i}`} x={xOf(idx)} y={H - 6} textAnchor="middle"
                fontSize="7.5" fill="rgba(148,163,184,0.45)" fontFamily="IBM Plex Mono, monospace">
                {pretty(p.stateLabel).slice(0, 8)}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ── App breakdown table ─────────────────────────────────────────────────── */
function AppBreakdownTable({ apps }: { apps: AppEntry[] }) {
  return (
    <div className="space-y-4">
      {apps.slice(0, 7).map((a, i) => (
        <div key={`${a.app}-${i}`}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-white font-medium truncate max-w-[120px]">{a.app}</span>
            <span className="text-slate-400 text-xs font-mono shrink-0 ml-2">{a.share}% of time</span>
          </div>
          {/* stacked mini bars */}
          <div className="flex gap-1">
            <div className="flex-1">
              <div className="text-[9px] font-mono text-emerald-400 mb-0.5">F {Math.round(a.avgFocus*100)}%</div>
              <HBar value={a.avgFocus} color="#34b27b" height="h-1.5" />
            </div>
            <div className="flex-1">
              <div className="text-[9px] font-mono text-amber-400 mb-0.5">C {Math.round(a.avgConfusion*100)}%</div>
              <HBar value={a.avgConfusion} color="#ef4444" height="h-1.5" />
            </div>
            <div className="flex-1">
              <div className="text-[9px] font-mono text-cyan-400 mb-0.5">Fa {Math.round(a.avgFatigue*100)}%</div>
              <HBar value={a.avgFatigue} color="#f59e0b" height="h-1.5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Friction hotspots ───────────────────────────────────────────────────── */
function FrictionList({ hotspots }: { hotspots: HotSpot[] }) {
  if (!hotspots.length) return <p className="text-sm text-slate-500 italic">No friction hotspots recorded yet.</p>;
  return (
    <div className="space-y-3">
      {hotspots.slice(0, 7).map((h) => {
        const score = Math.round(h.frictionScore * 100);
        return (
          <div key={h.artifactId || h.artifactLabel}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-white truncate max-w-[180px]">{h.artifactLabel}</span>
              <span className="ml-2 shrink-0 font-semibold" style={{ color: clr(1 - h.frictionScore) }}>{score}%</span>
            </div>
            <HBar value={score} max={100} color={clr(1 - h.frictionScore)} height="h-1.5" />
            <div className="mt-0.5 flex gap-3 text-[10px] text-slate-500 font-mono">
              <span>visits {h.visits}</span>
              <span>revisits {h.revisits}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Alert badge row ─────────────────────────────────────────────────────── */
function AlertGrid({ totals }: { totals: DashboardPayload["analytics"]["alertTotals"] }) {
  const items = [
    { label: "Residue", value: totals.attentionResidue, Icon: TimerReset, color: "#fbbf24" },
    { label: "Pre-error", value: totals.preError, Icon: AlertTriangle, color: "#ef4444" },
    { label: "Fatigue", value: totals.fatigue, Icon: Brain, color: "#f59e0b" },
    { label: "Confusion ep.", value: totals.confusionEpisodes, Icon: Activity, color: "#6aa9ff" },
    { label: "Handoffs", value: totals.handoffCapsules, Icon: Database, color: "#94a3b8" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, value, Icon, color }) => (
        <div key={label} className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4 text-center">
          <div className="flex justify-center mb-2" style={{ color }}><Icon className="h-5 w-5" /></div>
          <div className="text-2xl font-bold text-white">{value}</div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Node type breakdown ─────────────────────────────────────────────────── */
function NodeTypePills({ nodeTypes }: { nodeTypes: Record<string, number> }) {
  const TYPE_COLORS_MAP: Record<string, string> = {
    app: "#8b5cf6", application: "#8b5cf6", window: "#fbbf24", artifact: "#22d3ee",
    session: "#34b27b", user: "#6aa9ff", state: "#f87171", classifier_state: "#fb7185",
    cursor_state: "#a78bfa", expression: "#fbbf24", snapshot: "#94a3b8",
  };
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(nodeTypes).map(([type, count]) => (
        <div key={type} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS_MAP[type] || "#94a3b8" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-300">{type}</span>
          <span className="text-white font-semibold text-xs ml-1">{count}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [dataReady, setDataReady]   = useState(false);
  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  useEffect(() => {
    let active = true;
    const load = async (bg = false) => {
      if (!bg) setLoading(true); else setRefreshing(true);
      try {
        const r = await fetch(DASHBOARD_URL, { cache: "no-store" });
        const p = await r.json();
        if (!r.ok) throw new Error(p?.message || "Unable to load dashboard.");
        if (active) { setData(p); setError(null); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Unable to load dashboard.");
      } finally {
        if (active) { setLoading(false); setRefreshing(false); setDataReady(true); }
      }
    };
    load();
    return () => { active = false; };
  }, [nonce]);

  const s = data?.summary;
  const a = data?.analytics;
  const timeline = a?.scoreTimeline.slice(-24) || [];
  const graph = data?.live.graph;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#05090f_0%,#0a1219_45%,#081018_100%)] text-white">
      {/* ── loading splash (full-page, replaces the old "Loading from MongoDB" text) ── */}
      {showSplash && (
        <DashboardLoadingSplash
          onDone={handleSplashDone}
          dataReady={dataReady}
          minDuration={2400}
        />
      )}
      <Navbar />
      <main className="mx-auto max-w-7xl px-6 pb-16 pt-28">

        {/* ── header ───────────────────────────────────────────────────── */}
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.36em] text-emerald-300/70">Overall DB analytics · cognitive observer</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Cognitive Dashboard</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {[
              [`${s?.snapshotCount ?? "—"} snapshots`, "#34b27b"],
              [pretty(s?.topState), "#6aa9ff"],
            ].map(([label, col]) => (
              <span key={label} className="rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em]"
                style={{ borderColor: `${col}40`, background: `${col}18`, color: col }}>{label}</span>
            ))}
            <button type="button" onClick={() => setNonce((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
            </button>
          </div>
        </div>

        {/* ── loading: handled by full-page splash above ─────────── */}
        {loading ? null : error ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-500/10 p-8 text-red-100">{error}</div>
        ) : !data ? null : (
          <div className="space-y-6">

            {/* ── row 1: KPI cards ──────────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard icon={<Brain className="h-4 w-4"/>} label="Avg Focus Depth" value={pct(s?.avgFocusDepth)}
                sub={`deep-focus ${s?.deepFocusRate ?? 0}% of session`} color="#34b27b" />
              <KpiCard icon={<Activity className="h-4 w-4"/>} label="Avg Confusion Risk" value={pct(s?.avgConfusionRisk)}
                sub={`harmful confusion ${s?.harmfulConfusionRate ?? 0}%`} color="#ef4444" />
              <KpiCard icon={<AlertTriangle className="h-4 w-4"/>} label="Avg Fatigue Risk" value={pct(s?.avgFatigueRisk)}
                sub={`fatigue-state ${s?.fatigueRate ?? 0}% of snapshots`} color="#f59e0b" />
              <KpiCard icon={<Network className="h-4 w-4"/>} label="Avg Interruptibility" value={pct(s?.avgInterruptibility)}
                sub={`${graph?.stats.nodeCount ?? 0} graph nodes · ${graph?.stats.relationCount ?? 0} links`} color="#6aa9ff" />
            </div>

            {/* ── row 2: alert totals banner ────────────────────────────── */}
            {/* <AlertGrid totals={a!.alertTotals} /> */}

            {/* ── row 3: timeline + score averages ─────────────────────── */}
            <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
              <Panel eyebrow="Signal timeline" title="Score movement over time" aside={`${timeline.length} snapshots`}>
                <SignalTimeline timeline={timeline} />
              </Panel>
              <Panel eyebrow="DB averages" title="All 6 cognitive scores">
                <ScoreAverageBars averages={a?.scoreAverages || []} />
              </Panel>
            </div>

            {/* ── row 4: state distribution + state transitions ────────── */}
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel eyebrow="State distribution" title="Cognitive state breakdown">
                <StateDistBars distribution={a?.stateDistribution || []} />
              </Panel>
              <Panel eyebrow="State transitions" title="How states flow into each other">
                <TransitionTable transitions={a?.stateTransitions || []} />
              </Panel>
            </div>

            {/* ── row 5: 3D graph ───────────────────────────────────────── */}
            <Panel
              eyebrow="Neo4j entity graph · DB context"
              title="Observer graph — entities & relations"
              aside={`${graph?.stats.nodeCount ?? 0} nodes / ${graph?.stats.relationCount ?? 0} links`}
            >
              <AnalyticsNodeGraph nodes={graph?.nodes ?? []} links={graph?.links ?? []} height={500} />

              {/* graph stat pills */}
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Total nodes", graph?.stats.nodeCount ?? 0],
                  ["Total links", graph?.stats.relationCount ?? 0],
                  ["DB nodes", graph?.stats.dbNodeCount ?? 0],
                  ["DB links", graph?.stats.dbRelationCount ?? 0],
                  ["Snapshots", s?.snapshotCount ?? 0],
                  ["State types", Object.keys(graph?.stats.nodeTypes ?? {}).length],
                ].map(([lbl, val]) => (
                  <div key={String(lbl)} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center">
                    <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-slate-500">{lbl}</div>
                    <div className="mt-1 text-xl font-bold text-white">{val}</div>
                  </div>
                ))}
              </div>

              {/* node-type pills */}
              <div className="mt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">Node types</div>
                <NodeTypePills nodeTypes={graph?.stats.nodeTypes ?? {}} />
              </div>
            </Panel>

            {/* ── row 6: app breakdown + friction hotspots ─────────────── */}
            {/* <div className="grid gap-6 xl:grid-cols-2">
              <Panel eyebrow="Per-app analysis" title="App workload & cognitive impact">
                <AppBreakdownTable apps={a?.appBreakdown || []} />
              </Panel>
              <Panel eyebrow="Friction analysis" title="Highest-friction artifacts">
                <FrictionList hotspots={a?.frictionHotspots || []} />
              </Panel>
            </div> */}

            {/* ── row 7: score extremes ─────────────────────────────────── */}
            <Panel eyebrow="Score extremes" title="Peak cognitive moments in the DB">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Highest Focus", point: a?.scoreExtremes.highestFocus, field: "focusDepth", color: "#34b27b", Icon: TrendingUp },
                  { label: "Highest Confusion", point: a?.scoreExtremes.highestConfusion, field: "confusionRisk", color: "#ef4444", Icon: Brain },
                  { label: "Highest Fatigue", point: a?.scoreExtremes.highestFatigue, field: "fatigueRisk", color: "#f59e0b", Icon: Eye },
                ].map(({ label, point, field, color, Icon }) => (
                  <div key={label} className="rounded-[1.6rem] border border-white/8 bg-white/[0.03] p-5">
                    <div className="flex items-center gap-2 mb-3" style={{ color }}>
                      <Icon className="h-4 w-4" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.24em]">{label}</span>
                    </div>
                    {point ? (
                      <>
                        <div className="text-3xl font-bold text-white mb-1">{pct((point as unknown as Record<string, number>)[field])}</div>
                        <div className="text-xs text-slate-400 capitalize">{pretty(point.stateLabel)}</div>
                        <HBar value={(point as unknown as Record<string, number>)[field]} color={color} />
                      </>
                    ) : (
                      <div className="text-slate-500 text-sm italic">No data</div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

          </div>
        )}
      </main>
    </div>
  );
}

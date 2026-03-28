"use client";

import {
  Activity,
  AlertTriangle,
  Brain,
  Clock3,
  GitBranch,
  Layers,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Navbar from "@/components/Navbar";
import { cn } from "@/lib/utils";
import { SERVER_URL } from "@/utils/commonHelper";

type StateDistribution = { label: string; count: number; percentage: number };
type ScoreAverage = { key: string; label: string; value: number };
type TimelinePoint = { timestamp: string | null; stateLabel: string; focusDepth: number; confusionRisk: number; fatigueRisk: number; interruptibility: number };
type Hotspot = { artifactId: string; artifactLabel: string; frictionScore: number; visits: number; revisits: number; createdAt: string | null };
type DashboardEvent = { id: string; timestamp: string; createdAt: string | null; message: string };
type ConfusionEpisode = { episodeId: string; status: string; peakConfusion: number; durationS: number | null; activeApp: string; startedAt: string | null };
type StateTransition = { from: string; to: string; count: number };
type AppBreakdown = { app: string; count: number; share: number; avgFocus: number; avgConfusion: number; avgFatigue: number };
type ExtremePoint = { timestamp: string | null; stateLabel: string; focusDepth: number; confusionRisk: number; fatigueRisk: number; interruptibility: number };
type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  source: { mongoConnected: boolean; liveConnected: boolean; liveError: string | null };
  summary: {
    snapshotCount: number; latestGeneratedAt: string | null; latestState: string; topState: string;
    avgFocusDepth: number; avgConfusionRisk: number; avgFatigueRisk: number; avgInterruptibility: number;
    deepFocusRate: number; harmfulConfusionRate: number; fatigueRate: number;
  };
  analytics: {
    stateDistribution: StateDistribution[]; scoreAverages: ScoreAverage[]; scoreTimeline: TimelinePoint[];
    stateTransitions: StateTransition[]; appBreakdown: AppBreakdown[];
    scoreExtremes: { highestFocus: ExtremePoint | null; highestConfusion: ExtremePoint | null; highestFatigue: ExtremePoint | null; highestInterruptibility: ExtremePoint | null };
    alertTotals: { attentionResidue: number; preError: number; fatigue: number; confusionEpisodes: number; handoffCapsules: number };
    frictionHotspots: Hotspot[]; recentEvents: DashboardEvent[]; confusionEpisodes: ConfusionEpisode[]; insights: string[];
  };
};

const DASHBOARD_URL = `${SERVER_URL}/api/cognitive/dashboard`;
const STATE_COLORS: Record<string, string> = { deep_focus: "#34b27b", focused: "#4ade80", steady: "#6aa9ff", productive_struggle: "#ffb347", confused: "#f59e0b", harmful_confusion: "#ff8a4c", fatigued: "#e54b4f", calibrating: "#8c5cff", unknown: "#94a3b8" };
const SERIES = [
  { key: "focusDepth", label: "Focus", color: "#34b27b" },
  { key: "confusionRisk", label: "Confusion", color: "#ffb347" },
  { key: "fatigueRisk", label: "Fatigue", color: "#e54b4f" },
  { key: "interruptibility", label: "Interruptibility", color: "#6aa9ff" },
] as const;

const humanize = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const pct = (v: number) => `${Math.round(v * 100)}%`;
const formatDateTime = (v: string | null) => !v || Number.isNaN(new Date(v).getTime()) ? "—" : new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatCompact = (v: string | null) => !v || Number.isNaN(new Date(v).getTime()) ? "—" : new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const linePath = (vals: number[], w: number, h: number) => !vals.length ? `M0 ${h / 2} L${w} ${h / 2}` : vals.map((v, i) => `${i === 0 ? "M" : "L"} ${((i / Math.max(vals.length - 1, 1)) * w).toFixed(1)} ${(h - Math.max(0, Math.min(1, v)) * h).toFixed(1)}`).join(" ");
const areaPath = (vals: number[], w: number, h: number) => !vals.length ? "" : `${linePath(vals, w, h)} L${w} ${h} L0 ${h} Z`;

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("glass-card relative overflow-hidden border-border/70 bg-card/72", className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(var(--primary-rgb), 0.75), transparent)" }} />
      <p className="pill-badge mb-3">Analytics</p>
      <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Metric({ label, value, helper, icon: Icon, color }: { label: string; value: string; helper: string; icon: LucideIcon; color: string }) {
  return (
    <div className="glass-card relative overflow-hidden border-border/60 bg-card/65 px-5 py-5">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="mb-4 flex items-center justify-between">
        <span className="stat-chip">{label}</span>
        <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${color}1f`, color }}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="font-serif text-3xl text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{helper}</p>
    </div>
  );
}

function Bar({ label, value, color, note }: { label: string; value: number; color: string; note?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-sm font-medium text-foreground">{label}</p>{note ? <p className="text-xs text-muted-foreground">{note}</p> : null}</div>
        <span className="font-mono text-xs uppercase tracking-[0.2em]" style={{ color }}>{pct(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-background/80">
        <div className="h-full rounded-full" style={{ width: `${Math.max(6, Math.min(value, 1) * 100)}%`, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-border/70 bg-background/35 px-4 py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (silent: boolean) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetch(DASHBOARD_URL, { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload & { message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Unable to load analytics.");
      startTransition(() => { setData(payload); setError(null); });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to load analytics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
    const timer = window.setInterval(() => void loadDashboard(true), 8000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  const donut = useMemo(() => {
    const radius = 66;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return (data?.analytics.stateDistribution ?? []).map((item) => {
      const dash = (item.percentage / 100) * circumference;
      const color = STATE_COLORS[item.label] ?? STATE_COLORS.unknown;
      const arc = { dasharray: `${dash} ${circumference - dash}`, dashoffset: -offset };
      offset += dash;
      return { ...item, color, arc };
    });
  }, [data]);

  const alerts = data ? [
    { label: "Attention residue", value: data.analytics.alertTotals.attentionResidue, icon: Activity, color: "#6aa9ff" },
    { label: "Pre-error alerts", value: data.analytics.alertTotals.preError, icon: AlertTriangle, color: "#e54b4f" },
    { label: "Fatigue alerts", value: data.analytics.alertTotals.fatigue, icon: TrendingUp, color: "#ff8a4c" },
    { label: "Confusion episodes", value: data.analytics.alertTotals.confusionEpisodes, icon: Brain, color: "#ffb347" },
    { label: "Handoff capsules", value: data.analytics.alertTotals.handoffCapsules, icon: Clock3, color: "#8c5cff" },
  ] : [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at top center, rgba(var(--primary-rgb), 0.18), transparent 32%), radial-gradient(circle at 85% 20%, rgba(106, 169, 255, 0.15), transparent 28%), linear-gradient(to bottom, rgba(17, 24, 28, 0.96), rgba(17, 24, 28, 1))" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.018) 3px, rgba(255,255,255,0.018) 6px)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(rgba(var(--primary-rgb), 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--primary-rgb), 0.05) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
      <Navbar />

      <div className="relative z-10 mx-auto max-w-7xl px-6 pb-16 pt-32">
        <section className="relative overflow-hidden rounded-[32px] border border-border/70 bg-card/72 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur md:px-8">
          <div aria-hidden className="pointer-events-none absolute -right-24 top-0 h-56 w-56 rounded-full blur-3xl" style={{ background: "rgba(var(--primary-rgb), 0.18)" }} />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className="pill-badge">Cognitive Analytics Dashboard</span>
              <h1 className="mt-5 font-serif text-4xl leading-tight text-foreground md:text-5xl">Homepage-matched analytics for NeuroTrace.</h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-muted-foreground">The dashboard now stays in the same green-glow, serif-heading, glass-card visual system as the homepage while keeping the view analytics-only.</p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <button type="button" onClick={() => void loadDashboard(true)} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:bg-background">
                <RefreshCw className={cn("h-4 w-4", refreshing ? "animate-spin" : "")} />
                {refreshing ? "Refreshing..." : "Refresh analytics"}
              </button>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground sm:justify-end">
                <span className="stat-chip">Generated {formatDateTime(data?.generatedAt ?? null)}</span>
                <span className="stat-chip">{data?.summary.snapshotCount ?? 0} snapshots</span>
                <span className="stat-chip">Mongo {data?.source.mongoConnected ? "connected" : "offline"}</span>
                <span className="stat-chip">Python {data?.source.liveConnected ? "connected" : "offline"}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-8">
          {loading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="glass-card h-40 animate-pulse border-border/60 bg-card/55" />)}</div>
          ) : error ? (
            <section className="glass-card border-destructive/40 bg-destructive/10 text-center">
              <p className="pill-badge-red mx-auto mb-4">Analytics unavailable</p>
              <h2 className="font-serif text-3xl text-foreground">The dashboard could not load right now.</h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">{error}{data?.source.liveError ? ` Live source details: ${data.source.liveError}` : ""}</p>
            </section>
          ) : data ? (
            <div className="space-y-8">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="Top state" value={humanize(data.summary.topState)} helper="Most frequent stored cognitive state." icon={Layers} color={STATE_COLORS[data.summary.topState] ?? STATE_COLORS.unknown} />
                <Metric label="Deep focus rate" value={pct(data.summary.deepFocusRate)} helper="Low-friction work windows." icon={Zap} color="#34b27b" />
                <Metric label="Harmful confusion" value={pct(data.summary.harmfulConfusionRate)} helper="High-risk confusion windows." icon={TriangleAlert} color="#ffb347" />
                <Metric label="Fatigue rate" value={pct(data.summary.fatigueRate)} helper="Fatigue-related windows captured." icon={Brain} color="#e54b4f" />
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.55fr,1fr]">
                <Card title="Trend lines across stored windows" subtitle="Focus, confusion, fatigue, and interruptibility over time.">
                  {data.analytics.scoreTimeline.length ? (
                    <div className="space-y-5">
                      <div className="flex flex-wrap gap-3">{SERIES.map((s) => <div key={s.key} className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/45 px-3 py-1.5 text-xs text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</div>)}</div>
                      <div className="overflow-hidden rounded-[28px] border border-border/60 bg-background/35 p-4">
                        <svg viewBox="0 0 860 260" className="h-72 w-full">
                          {[0, 0.25, 0.5, 0.75, 1].map((level) => <line key={level} x1="0" y1={260 - level * 260} x2="860" y2={260 - level * 260} stroke="rgba(185,194,201,0.12)" strokeDasharray="6 10" />)}
                          <path d={areaPath(data.analytics.scoreTimeline.map((p) => p.focusDepth), 860, 260)} fill="rgba(52,178,123,0.14)" />
                          {SERIES.map((s) => <path key={s.key} d={linePath(data.analytics.scoreTimeline.map((p) => p[s.key as keyof TimelinePoint] as number), 860, 260)} fill="none" stroke={s.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
                        </svg>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                          <div className="rounded-2xl border border-border/50 bg-card/45 px-3 py-2">Start {formatCompact(data.analytics.scoreTimeline[0]?.timestamp ?? null)}</div>
                          <div className="rounded-2xl border border-border/50 bg-card/45 px-3 py-2 text-center">Mid {formatCompact(data.analytics.scoreTimeline[Math.floor((data.analytics.scoreTimeline.length - 1) / 2)]?.timestamp ?? null)}</div>
                          <div className="rounded-2xl border border-border/50 bg-card/45 px-3 py-2 text-right">Latest {formatCompact(data.analytics.scoreTimeline[data.analytics.scoreTimeline.length - 1]?.timestamp ?? null)}</div>
                        </div>
                      </div>
                    </div>
                  ) : <Empty text="Timeline graphs will appear after enough windows are stored." />}
                </Card>

                <Card title="State distribution and score bars" subtitle="Session-wide state mix plus average signal intensity.">
                  <div className="space-y-8">
                    {donut.length ? (
                      <div className="grid gap-6 lg:grid-cols-[220px,1fr]">
                        <div className="relative mx-auto h-[220px] w-[220px]">
                          <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
                            <circle cx="90" cy="90" r="66" fill="none" stroke="rgba(185,194,201,0.12)" strokeWidth="18" />
                            {donut.map((item) => <circle key={item.label} cx="90" cy="90" r="66" fill="none" stroke={item.color} strokeWidth="18" strokeLinecap="round" strokeDasharray={item.arc.dasharray} strokeDashoffset={item.arc.dashoffset} />)}
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="stat-chip mb-3">Top state</span><p className="text-center font-serif text-2xl text-foreground">{humanize(data.summary.topState)}</p></div>
                        </div>
                        <div className="space-y-4">{donut.map((item) => <div key={item.label} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-3"><div className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="h-3 w-3 rounded-full" style={{ background: item.color }} /><span className="text-sm font-medium text-foreground">{humanize(item.label)}</span></div><span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">{item.count} samples</span></div><div className="h-2 rounded-full bg-background/80"><div className="h-full rounded-full" style={{ width: `${Math.max(item.percentage, 4)}%`, background: `linear-gradient(90deg, ${item.color}aa, ${item.color})` }} /></div></div>)}</div>
                      </div>
                    ) : <Empty text="State distribution will appear after more snapshots are written." />}
                    <div className="space-y-4">{data.analytics.scoreAverages.length ? data.analytics.scoreAverages.map((score) => <Bar key={score.key} label={score.label} value={score.value} color={SERIES.find((s) => s.key === score.key)?.color ?? "#34b27b"} />) : <Empty text="Average score bars will appear once enough data is stored." />}</div>
                  </div>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <Card title="State transitions" subtitle="How often one state turns into another.">
                  <div className="space-y-4">{data.analytics.stateTransitions.length ? data.analytics.stateTransitions.map((t) => <div key={`${t.from}-${t.to}`} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><GitBranch className="h-4 w-4" /></div><div><p className="text-sm font-medium text-foreground">{humanize(t.from)} to {humanize(t.to)}</p><p className="text-xs text-muted-foreground">Stored transition count</p></div></div><span className="font-serif text-2xl text-foreground">{t.count}</span></div><div className="h-2 rounded-full bg-background/80"><div className="h-full rounded-full bg-gradient-to-r from-primary via-chart-2 to-chart-3" style={{ width: `${Math.min(100, t.count * 16)}%` }} /></div></div>) : <Empty text="Transition analytics will appear after more state windows are captured." />}</div>
                </Card>

                <Card title="App breakdown" subtitle="Per-app focus, confusion, and fatigue averages.">
                  <div className="space-y-4">{data.analytics.appBreakdown.length ? data.analytics.appBreakdown.map((app) => <div key={app.app} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-foreground">{app.app}</p><p className="text-xs text-muted-foreground">{app.count} windows • {Math.round(app.share)}% share</p></div><span className="stat-chip">Active app</span></div><div className="space-y-3"><Bar label="Avg focus" value={app.avgFocus} color="#34b27b" /><Bar label="Avg confusion" value={app.avgConfusion} color="#ffb347" /><Bar label="Avg fatigue" value={app.avgFatigue} color="#e54b4f" /></div></div>) : <Empty text="App analytics will appear when stored snapshots include enough app context." />}</div>
                </Card>

                <Card title="Alert totals" subtitle="Aggregated intervention signals from MongoDB.">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">{alerts.map((a) => { const Icon = a.icon; return <div key={a.label} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full" style={{ background: `${a.color}1f`, color: a.color }}><Icon className="h-5 w-5" /></div><p className="font-serif text-3xl text-foreground">{a.value}</p><p className="mt-2 text-sm text-muted-foreground">{a.label}</p></div>; })}</div>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.05fr,1fr]">
                <Card title="Extremes and insights" subtitle="Strongest recorded windows and AI-generated interpretations.">
                  <div className="grid gap-4 md:grid-cols-2">{[
                    { label: "Peak focus", value: data.analytics.scoreExtremes.highestFocus?.focusDepth ?? null, point: data.analytics.scoreExtremes.highestFocus, color: "#34b27b" },
                    { label: "Peak confusion", value: data.analytics.scoreExtremes.highestConfusion?.confusionRisk ?? null, point: data.analytics.scoreExtremes.highestConfusion, color: "#ffb347" },
                    { label: "Peak fatigue", value: data.analytics.scoreExtremes.highestFatigue?.fatigueRisk ?? null, point: data.analytics.scoreExtremes.highestFatigue, color: "#e54b4f" },
                    { label: "Peak interruptibility", value: data.analytics.scoreExtremes.highestInterruptibility?.interruptibility ?? null, point: data.analytics.scoreExtremes.highestInterruptibility, color: "#6aa9ff" },
                  ].map((item) => <div key={item.label} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><p className="font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: item.color }}>{item.label}</p><p className="mt-3 font-serif text-3xl text-foreground">{typeof item.value === "number" ? pct(item.value) : "—"}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{item.point ? humanize(item.point.stateLabel) : "No state captured"}<br />{formatDateTime(item.point?.timestamp ?? null)}</p></div>)}</div>
                  <div className="mt-6 space-y-3">{data.analytics.insights.length ? data.analytics.insights.map((insight) => <div key={insight} className="flex gap-3 rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></div><p className="text-sm leading-7 text-muted-foreground">{insight}</p></div>) : <Empty text="Insights will appear as more interpreted events land in MongoDB." />}</div>
                </Card>

                <Card title="Friction hotspots and confusion episodes" subtitle="Artifacts and sessions that most often correlate with struggle.">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-3">
                      <p className="pill-badge-amber w-fit">Friction hotspots</p>
                      {data.analytics.frictionHotspots.length ? data.analytics.frictionHotspots.map((spot) => <div key={spot.artifactId} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-foreground">{spot.artifactLabel}</p><p className="text-xs leading-6 text-muted-foreground">{spot.visits} visits • {spot.revisits} revisits<br />{formatDateTime(spot.createdAt)}</p></div><span className="rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: spot.frictionScore >= 0.5 ? "#e54b4f" : "#ffb347", background: spot.frictionScore >= 0.5 ? "rgba(229,75,79,0.12)" : "rgba(255,179,71,0.12)" }}>{pct(spot.frictionScore)}</span></div><div className="h-2 rounded-full bg-background/80"><div className="h-full rounded-full bg-gradient-to-r from-chart-3 via-[#ff8a4c] to-destructive" style={{ width: `${Math.max(6, Math.min(spot.frictionScore, 1) * 100)}%` }} /></div></div>) : <Empty text="No friction hotspots have been stored yet." />}
                    </div>
                    <div className="space-y-3">
                      <p className="pill-badge-red w-fit">Confusion episodes</p>
                      {data.analytics.confusionEpisodes.length ? data.analytics.confusionEpisodes.map((episode) => <div key={episode.episodeId} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-foreground">{episode.activeApp || "Unknown app"}</p><p className="text-xs leading-6 text-muted-foreground">Peak confusion {pct(episode.peakConfusion)}<br />{episode.durationS !== null ? `${episode.durationS}s duration` : "Duration still ongoing"}</p></div><span className="rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: episode.status === "ongoing" ? "#e54b4f" : "#34b27b", background: episode.status === "ongoing" ? "rgba(229,75,79,0.12)" : "rgba(52,178,123,0.12)" }}>{humanize(episode.status)}</span></div><p className="text-xs text-muted-foreground">Started {formatDateTime(episode.startedAt)}</p></div>) : <Empty text="No confusion episodes have been stored yet." />}
                    </div>
                  </div>
                </Card>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1fr,1.1fr]">
                <Card title="Recent event stream" subtitle="Latest event-level notes pulled from MongoDB.">
                  <div className="space-y-3">{data.analytics.recentEvents.length ? data.analytics.recentEvents.map((event) => <div key={event.id} className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs uppercase tracking-[0.22em] text-primary">{event.timestamp || formatCompact(event.createdAt)}</span><span className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span></div><p className="text-sm leading-7 text-muted-foreground">{event.message}</p></div>) : <Empty text="Event stream cards will appear after observer events are stored." />}</div>
                </Card>

                <Card title="At-a-glance analysis readout" subtitle="Quick score bars and session health indicators.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4">
                      <p className="stat-chip mb-4">Core averages</p>
                      <div className="space-y-4">
                        <Bar label="Average focus depth" value={data.summary.avgFocusDepth} color="#34b27b" />
                        <Bar label="Average confusion risk" value={data.summary.avgConfusionRisk} color="#ffb347" />
                        <Bar label="Average fatigue risk" value={data.summary.avgFatigueRisk} color="#e54b4f" />
                        <Bar label="Average interruptibility" value={data.summary.avgInterruptibility} color="#6aa9ff" />
                      </div>
                    </div>
                    <div className="rounded-3xl border border-border/60 bg-background/40 px-4 py-4 space-y-4">
                      <div className="rounded-2xl border border-border/50 bg-card/45 px-4 py-3"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest stored state</p><p className="mt-2 font-serif text-2xl text-foreground">{humanize(data.summary.latestState)}</p></div>
                      <div className="rounded-2xl border border-border/50 bg-card/45 px-4 py-3"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest sample time</p><p className="mt-2 text-sm leading-7 text-foreground">{formatDateTime(data.summary.latestGeneratedAt)}</p></div>
                      <div className="rounded-2xl border border-border/50 bg-card/45 px-4 py-3"><p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Data source health</p><p className="mt-2 text-sm leading-7 text-foreground">MongoDB is {data.source.mongoConnected ? "connected" : "offline"} and Python live feed is {data.source.liveConnected ? "connected" : "offline"}.</p></div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Clock3,
  Eye,
  Gauge,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { SERVER_URL } from "@/utils/commonHelper";

type StateDistribution = {
  label: string;
  count: number;
  percentage: number;
};

type ScoreAverage = {
  key: string;
  label: string;
  value: number;
};

type TimelinePoint = {
  timestamp: string | null;
  stateLabel: string;
  focusDepth: number;
  confusionRisk: number;
  fatigueRisk: number;
  interruptibility: number;
};

type Hotspot = {
  artifactId: string;
  artifactLabel: string;
  frictionScore: number;
  visits: number;
  revisits: number;
  createdAt: string | null;
};

type DashboardEvent = {
  id: string;
  timestamp: string;
  createdAt: string | null;
  message: string;
};

type ConfusionEpisode = {
  episodeId: string;
  status: string;
  peakConfusion: number;
  durationS: number | null;
  activeApp: string;
  activeWindow: string;
  startedAt: string | null;
  resolvedAt: string | null;
};

type TimeTracker = {
  session_label?: string;
  total_active_label?: string;
  idle_fraction?: number;
  top_apps?: Array<{ app: string; seconds: number; label: string }>;
};

type LiveCurrent = {
  generatedAt: string | null;
  stateLabel: string;
  classifierState: string;
  confidence: number;
  message: string;
  activeApp: string;
  activeWindow: string;
  blinkRate: number | null;
  perclos: number | null;
  expression: string;
  timeTracker: TimeTracker | null;
};

type DashboardPayload = {
  ok: boolean;
  generatedAt: string;
  source: {
    mongoConnected: boolean;
    liveConnected: boolean;
    liveUrl: string;
    liveError: string | null;
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
    deepFocusRate: number;
    harmfulConfusionRate: number;
    fatigueRate: number;
  };
  live: {
    current: LiveCurrent | null;
    teamRollup: {
      team_focus_health?: number;
      members_in_deep_work?: number;
      members_high_confusion?: number;
      member_count?: number;
    } | null;
  };
  analytics: {
    stateDistribution: StateDistribution[];
    scoreAverages: ScoreAverage[];
    scoreTimeline: TimelinePoint[];
    alertTotals: {
      attentionResidue: number;
      preError: number;
      fatigue: number;
      confusionEpisodes: number;
      handoffCapsules: number;
    };
    frictionHotspots: Hotspot[];
    recentEvents: DashboardEvent[];
    confusionEpisodes: ConfusionEpisode[];
    insights: string[];
  };
};

const DASHBOARD_URL = `${SERVER_URL}/api/cognitive/dashboard`;

const humanize = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatTime = (value: string | null) => {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No timestamp";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDateTime = (value: string | null) => {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No timestamp";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toneClasses: Record<string, string> = {
  deep_focus: "pill-badge",
  focused: "pill-badge",
  steady: "pill-badge",
  productive_struggle: "pill-badge-amber",
  confused: "pill-badge-amber",
  harmful_confusion: "pill-badge-red",
  fatigued: "pill-badge-red",
  calibrating: "pill-badge-amber",
  unknown: "pill-badge-amber",
};

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="glass-card rounded-[1.6rem] p-5">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function SectionCard({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-[1.8rem] p-6">
      <p className="text-xs uppercase tracking-[0.3em] text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-foreground">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (silent: boolean) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch(DASHBOARD_URL, { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload & { message?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Unable to load dashboard data.");
      }

      startTransition(() => {
        setData(payload);
        setError(null);
      });
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Unable to load dashboard data."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
    const interval = window.setInterval(() => {
      void loadDashboard(true);
    }, 6000);

    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  const liveCurrent = data?.live.current ?? null;
  const stateChipClass = toneClasses[liveCurrent?.stateLabel || "unknown"] || toneClasses.unknown;

  const headlineMetrics = useMemo(() => {
    if (!data) return [];

    return [
      {
        label: "Snapshots Analysed",
        value: String(data.summary.snapshotCount),
        hint: "Mongo-backed windows used for historical analysis.",
      },
      {
        label: "Average Focus",
        value: `${Math.round(data.summary.avgFocusDepth * 100)}%`,
        hint: "Mean focus depth across recent stored sessions.",
      },
      {
        label: "Average Confusion",
        value: `${Math.round(data.summary.avgConfusionRisk * 100)}%`,
        hint: "How often interaction patterns drift into uncertainty.",
      },
      {
        label: "Average Fatigue",
        value: `${Math.round(data.summary.avgFatigueRisk * 100)}%`,
        hint: "Keyboard, mouse, and camera fatigue trend.",
      },
    ];
  }, [data]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-0 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-[-6%] top-24 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 py-8 md:px-8">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="pill-badge">NeuroTrace Dashboard</span>
              <span className={stateChipClass}>
                {humanize(liveCurrent?.stateLabel || data?.summary.latestState || "unknown")}
              </span>
              <span className={data?.source.liveConnected ? "pill-badge" : "pill-badge-red"}>
                {data?.source.liveConnected ? "Live Python feed connected" : "Live Python feed offline"}
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
              Cognitive stats, live state, and Mongo-backed behavioral analysis.
            </h1>
            <p className="mt-3 max-w-3xl text-base text-muted-foreground md:text-lg">
              This dashboard combines realtime cognition from the Python observer with stored trends and alerts from MongoDB through the Express server.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadDashboard(true)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-[1.4rem] border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <p className="font-semibold text-foreground">Dashboard data could not be loaded</p>
                <p className="mt-1 text-muted-foreground">{error}</p>
              </div>
            </div>
          </div>
        )}

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="glass-card rounded-[2rem] p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className={stateChipClass}>
                {humanize(liveCurrent?.stateLabel || data?.summary.latestState || "unknown")}
              </span>
              <span className="stat-chip">
                Confidence {Math.round((liveCurrent?.confidence || 0) * 100)}%
              </span>
              <span className="stat-chip">
                Updated {formatTime(liveCurrent?.generatedAt || data?.generatedAt || null)}
              </span>
            </div>

            <div className="mt-5 grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-muted-foreground">Realtime interpretation</p>
                <h2 className="mt-3 text-3xl font-semibold">
                  {liveCurrent?.message || "Waiting for live cognition data from the Python backend."}
                </h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Active App</p>
                    <p className="mt-2 text-lg font-medium">{liveCurrent?.activeApp || "Unavailable"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {liveCurrent?.activeWindow || "Window details unavailable"}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Camera Layer</p>
                    <p className="mt-2 text-lg font-medium">
                      {liveCurrent && liveCurrent.perclos !== null
                        ? `PERCLOS ${Math.round((liveCurrent.perclos || 0) * 100)}%`
                        : "No live camera reading"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Blink {liveCurrent?.blinkRate ?? "--"} / min, expression {humanize(liveCurrent?.expression || "neutral")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-primary/20 bg-primary/8 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-primary">Live session</p>
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Session time</span>
                    <span className="font-medium">
                      {liveCurrent?.timeTracker?.session_label || "Not available"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Active work time</span>
                    <span className="font-medium">
                      {liveCurrent?.timeTracker?.total_active_label || "Not available"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">Idle fraction</span>
                    <span className="font-medium">
                      {typeof liveCurrent?.timeTracker?.idle_fraction === "number"
                        ? `${Math.round(liveCurrent.timeTracker.idle_fraction * 100)}%`
                        : "Not available"}
                    </span>
                  </div>
                </div>
                <div className="mt-5 border-t border-border/70 pt-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Top active apps</p>
                  <div className="mt-3 space-y-3">
                    {(liveCurrent?.timeTracker?.top_apps || []).slice(0, 3).map((app) => (
                      <div key={`${app.app}-${app.label}`}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate">{app.app}</span>
                          <span className="text-muted-foreground">{app.label}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(app.seconds / 180, 1) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {!liveCurrent?.timeTracker?.top_apps?.length && (
                      <p className="text-sm text-muted-foreground">Live time tracking data will appear here once the Python observer is running.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {headlineMetrics.map((metric) => (
              <MetricCard
                key={metric.label}
                label={metric.label}
                value={metric.value}
                hint={metric.hint}
              />
            ))}
          </div>
        </section>

        {loading && !data ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="glass-card h-64 animate-pulse rounded-[1.8rem]" />
            <div className="glass-card h-64 animate-pulse rounded-[1.8rem]" />
          </div>
        ) : data ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <SectionCard eyebrow="Distribution" title="State mix across stored windows">
                <div className="space-y-4">
                  {data.analytics.stateDistribution.map((state) => (
                    <div key={state.label}>
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <span>{humanize(state.label)}</span>
                        <span className="text-muted-foreground">
                          {state.count} windows · {state.percentage}%
                        </span>
                      </div>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400"
                          style={{ width: `${state.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Scores" title="Average risk and performance profile">
                <div className="grid gap-4 md:grid-cols-2">
                  {data.analytics.scoreAverages.map((score) => (
                    <div
                      key={score.key}
                      className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">{score.label}</p>
                        <p className="text-lg font-semibold">{Math.round(score.value * 100)}%</p>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-300"
                          style={{ width: `${Math.min(score.value, 1) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Trendline" title="Recent score timeline">
                <div className="space-y-3">
                  {data.analytics.scoreTimeline.map((point) => (
                    <div
                      key={`${point.timestamp}-${point.stateLabel}`}
                      className="rounded-[1.4rem] border border-border/70 bg-card/55 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{formatDateTime(point.timestamp)}</p>
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {humanize(point.stateLabel)}
                          </p>
                        </div>
                        <span className={toneClasses[point.stateLabel] || toneClasses.unknown}>
                          {humanize(point.stateLabel)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        {[
                          ["Focus", point.focusDepth],
                          ["Confusion", point.confusionRisk],
                          ["Fatigue", point.fatigueRisk],
                          ["Interrupt", point.interruptibility],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>{label}</span>
                              <span>{Math.round(Number(value) * 100)}%</span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400"
                                style={{ width: `${Math.min(Number(value), 1) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            <div className="space-y-6">
              <SectionCard eyebrow="Analysis" title="Generated insights">
                <div className="space-y-3">
                  {data.analytics.insights.map((insight) => (
                    <div
                      key={insight}
                      className="flex items-start gap-3 rounded-[1.4rem] border border-primary/15 bg-primary/8 p-4"
                    >
                      <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
                      <p className="text-sm leading-6 text-foreground">{insight}</p>
                    </div>
                  ))}
                  {!data.analytics.insights.length && (
                    <p className="text-sm text-muted-foreground">Insights will appear once enough data has been collected in MongoDB.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Watchlist" title="Alert totals and health flags">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      label: "Attention residue alerts",
                      value: data.analytics.alertTotals.attentionResidue,
                      icon: Activity,
                    },
                    {
                      label: "Pre-error alerts",
                      value: data.analytics.alertTotals.preError,
                      icon: AlertTriangle,
                    },
                    {
                      label: "Fatigue alerts",
                      value: data.analytics.alertTotals.fatigue,
                      icon: Eye,
                    },
                    {
                      label: "Handoff capsules",
                      value: data.analytics.alertTotals.handoffCapsules,
                      icon: Clock3,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4"
                    >
                      <item.icon className="h-5 w-5 text-primary" />
                      <p className="mt-3 text-2xl font-semibold">{item.value}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Friction" title="Highest-friction artifacts">
                <div className="space-y-4">
                  {data.analytics.frictionHotspots.map((hotspot) => (
                    <div key={hotspot.artifactId} className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{hotspot.artifactLabel}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {hotspot.visits} visits · {hotspot.revisits} revisits
                          </p>
                        </div>
                        <span className={hotspot.frictionScore >= 0.5 ? "pill-badge-red" : "pill-badge-amber"}>
                          {Math.round(hotspot.frictionScore * 100)}%
                        </span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
                          style={{ width: `${Math.min(hotspot.frictionScore, 1) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {!data.analytics.frictionHotspots.length && (
                    <p className="text-sm text-muted-foreground">No artifact friction data has been stored yet.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Events" title="Latest behavioral events">
                <div className="space-y-3">
                  {data.analytics.recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-[1.3rem] border border-border/70 bg-card/55 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{event.timestamp || formatTime(event.createdAt)}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{event.message}</p>
                    </div>
                  ))}
                  {!data.analytics.recentEvents.length && (
                    <p className="text-sm text-muted-foreground">Recent activity events will appear here once the observer starts storing them.</p>
                  )}
                </div>
              </SectionCard>

              <SectionCard eyebrow="Episodes" title="Confusion episode tracker">
                <div className="space-y-3">
                  {data.analytics.confusionEpisodes.map((episode) => (
                    <div
                      key={episode.episodeId}
                      className="rounded-[1.4rem] border border-border/70 bg-card/60 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-primary" />
                          <p className="font-medium">{episode.activeApp || "Unknown app"}</p>
                        </div>
                        <span className={episode.status === "ongoing" ? "pill-badge-red" : "pill-badge"}>
                          {humanize(episode.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Peak confusion {Math.round(episode.peakConfusion * 100)}%
                        {episode.durationS !== null ? ` · Duration ${episode.durationS}s` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Started {formatDateTime(episode.startedAt)}
                      </p>
                    </div>
                  ))}
                  {!data.analytics.confusionEpisodes.length && (
                    <p className="text-sm text-muted-foreground">No confusion episodes have been recorded in MongoDB yet.</p>
                  )}
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="glass-card rounded-[1.6rem] p-5">
            <div className="flex items-center gap-3">
              <Gauge className="h-5 w-5 text-primary" />
              <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Focus Health</p>
            </div>
            <p className="mt-4 text-3xl font-semibold">
              {data?.live.teamRollup?.team_focus_health ?? Math.round((data?.summary.avgFocusDepth || 0) * 100)}%
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Overall focus signal computed from recent stored sessions and the live observer.
            </p>
          </div>

          <div className="glass-card rounded-[1.6rem] p-5">
            <div className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-primary" />
              <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">Deep Work Windows</p>
            </div>
            <p className="mt-4 text-3xl font-semibold">{data?.summary.deepFocusRate ?? 0}%</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Share of recent snapshots that qualified as deep focus.
            </p>
          </div>

          <div className="glass-card rounded-[1.6rem] p-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-primary" />
              <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">High-Risk Windows</p>
            </div>
            <p className="mt-4 text-3xl font-semibold">
              {Math.round((data?.summary.harmfulConfusionRate || 0) + (data?.summary.fatigueRate || 0))}%
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Harmful confusion and fatigue combined, based on historical Mongo snapshots.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

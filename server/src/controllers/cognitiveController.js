import mongoose from "mongoose";

const LIVE_API_BASE = (
  process.env.COGNITIVE_LIVE_API_URL ||
  process.env.COGNITIVE_API_URL ||
  "http://127.0.0.1:8050"
).replace(/\/$/, "");

const SCORE_FIELDS = [
  ["focus_depth", "Focus depth"],
  ["attention_residue", "Attention residue"],
  ["pre_error_risk", "Pre-error risk"],
  ["confusion_risk", "Confusion risk"],
  ["fatigue_risk", "Fatigue risk"],
  ["interruptibility", "Interruptibility"],
];

const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const safeDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const serialiseDate = (value) => {
  const date = safeDate(value);
  return date ? date.toISOString() : null;
};

const average = (values) => {
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const percentage = (value, total) => {
  if (!total) return 0;
  return round((value / total) * 100, 1);
};

const normaliseLabel = (value, fallback = "unknown") => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim();
};

const collection = (name) => mongoose.connection.db.collection(`cognitive_${name}`);

async function fetchLiveDashboard() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${LIVE_API_BASE}/api/dashboard`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Live API responded with ${response.status}`);
    }

    const data = await response.json();
    return { connected: true, data, error: null };
  } catch (error) {
    return {
      connected: false,
      data: null,
      error: error instanceof Error ? error.message : "Unable to reach live cognitive API",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildStateDistribution(snapshots) {
  const counts = snapshots.reduce((accumulator, snapshot) => {
    const label = normaliseLabel(snapshot?.state_label, "steady");
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      percentage: percentage(count, snapshots.length),
    }))
    .sort((left, right) => right.count - left.count);
}

function buildScoreAverages(snapshots) {
  return SCORE_FIELDS.map(([key, label]) => ({
    key,
    label,
    value: average(
      snapshots
        .map((snapshot) => Number(snapshot?.scores?.[key]))
        .filter((value) => Number.isFinite(value))
    ),
  }));
}

function buildTimeline(snapshots) {
  return snapshots
    .slice(0, 24)
    .reverse()
    .map((snapshot) => ({
      timestamp: serialiseDate(snapshot?.generated_at),
      stateLabel: normaliseLabel(snapshot?.state_label, "steady"),
      focusDepth: round(Number(snapshot?.scores?.focus_depth || 0)),
      confusionRisk: round(Number(snapshot?.scores?.confusion_risk || 0)),
      fatigueRisk: round(Number(snapshot?.scores?.fatigue_risk || 0)),
      interruptibility: round(Number(snapshot?.scores?.interruptibility || 0)),
    }));
}

function buildStateTransitions(snapshots) {
  const ordered = [...snapshots].reverse();
  const counts = new Map();

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = normaliseLabel(ordered[index - 1]?.state_label, "steady");
    const current = normaliseLabel(ordered[index]?.state_label, "steady");
    const key = `${previous}->${current}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split("->");
      return { from, to, count };
    })
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
}

function buildAppBreakdown(snapshots) {
  const grouped = snapshots.reduce((accumulator, snapshot) => {
    const app = normaliseLabel(snapshot?.active_app, "Unknown");
    if (!accumulator[app]) {
      accumulator[app] = {
        app,
        count: 0,
        focus: [],
        confusion: [],
        fatigue: [],
      };
    }

    accumulator[app].count += 1;
    accumulator[app].focus.push(Number(snapshot?.scores?.focus_depth || 0));
    accumulator[app].confusion.push(Number(snapshot?.scores?.confusion_risk || 0));
    accumulator[app].fatigue.push(Number(snapshot?.scores?.fatigue_risk || 0));
    return accumulator;
  }, {});

  return Object.values(grouped)
    .map((entry) => ({
      app: entry.app,
      count: entry.count,
      share: percentage(entry.count, snapshots.length),
      avgFocus: average(entry.focus.filter(Number.isFinite)),
      avgConfusion: average(entry.confusion.filter(Number.isFinite)),
      avgFatigue: average(entry.fatigue.filter(Number.isFinite)),
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function buildScoreExtremes(timeline) {
  const maxBy = (field) =>
    timeline.reduce((best, point) => {
      if (!best || Number(point[field]) > Number(best[field])) return point;
      return best;
    }, null);

  return {
    highestFocus: maxBy("focusDepth"),
    highestConfusion: maxBy("confusionRisk"),
    highestFatigue: maxBy("fatigueRisk"),
    highestInterruptibility: maxBy("interruptibility"),
  };
}

function buildInsights({ liveCurrent, summary, distribution, hotspots, alertTotals }) {
  const insights = [];

  if (liveCurrent?.stateLabel) {
    insights.push(
      `Right now the system sees ${liveCurrent.stateLabel.replace(/_/g, " ")} in ${liveCurrent.activeApp || "the active app"}.`
    );
  }

  if (summary.avgFatigueRisk >= 0.55) {
    insights.push("Fatigue risk is elevated across recent sessions, so break timing is becoming important.");
  } else if (summary.avgFocusDepth >= 0.6) {
    insights.push("Recent interaction patterns are mostly stable, with focus depth staying in a healthy range.");
  }

  const leadingState = distribution[0];
  if (leadingState) {
    insights.push(
      `${leadingState.label.replace(/_/g, " ")} is the most common recent state at ${leadingState.percentage}% of recorded windows.`
    );
  }

  const hotspot = hotspots[0];
  if (hotspot && hotspot.frictionScore >= 0.5) {
    insights.push(`The highest-friction artifact right now is ${hotspot.artifactLabel}.`);
  }

  if (alertTotals.confusionEpisodes > 0 || alertTotals.preError > 0 || alertTotals.fatigue > 0) {
    insights.push(
      `Mongo history includes ${alertTotals.confusionEpisodes} confusion episodes, ${alertTotals.preError} pre-error alerts, and ${alertTotals.fatigue} fatigue alerts.`
    );
  }

  return insights.slice(0, 4);
}

function mapLiveCurrent(liveData) {
  const current = liveData?.current;
  if (!current) return null;

  return {
    generatedAt: current.generated_at || null,
    stateLabel: normaliseLabel(current.state_label, "unknown"),
    classifierState: normaliseLabel(current?.state?.name, "unknown"),
    confidence: round(Number(current?.state?.confidence || 0), 2),
    message: normaliseLabel(current?.state?.message, ""),
    activeApp: normaliseLabel(current?.active_app, ""),
    activeWindow: normaliseLabel(current?.active_window, ""),
    blinkRate: Number.isFinite(Number(current?.camera?.blink_rate_per_min))
      ? round(Number(current.camera.blink_rate_per_min), 1)
      : null,
    perclos: Number.isFinite(Number(current?.camera?.perclos))
      ? round(Number(current.camera.perclos))
      : null,
    expression: normaliseLabel(current?.camera?.expression, "neutral"),
    timeTracker: current?.time_tracker || null,
  };
}

export const getCognitiveDashboard = async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return res.status(503).json({
        ok: false,
        message: "MongoDB is not connected yet.",
      });
    }

    const [
      snapshots,
      events,
      artifacts,
      confusionEpisodes,
      residueEvents,
      preErrorEvents,
      fatigueEvents,
      handoffCapsules,
      liveDashboard,
    ] = await Promise.all([
      collection("snapshots").find({}).sort({ generated_at: -1 }).limit(120).toArray(),
      collection("events").find({}).sort({ created_at: -1 }).limit(12).toArray(),
      collection("artifacts").find({}).sort({ created_at: -1 }).limit(40).toArray(),
      collection("confusion_episodes").find({}).sort({ started_at: -1 }).limit(8).toArray(),
      collection("attention_residue_events").countDocuments(),
      collection("pre_error_events").countDocuments(),
      collection("fatigue_events").countDocuments(),
      collection("handoff_capsules").countDocuments(),
      fetchLiveDashboard(),
    ]);

    const distribution = buildStateDistribution(snapshots);
    const latestSnapshot = snapshots[0] || null;
    const liveCurrent = mapLiveCurrent(liveDashboard.data);
    const timeline = buildTimeline(snapshots);

    const summary = {
      snapshotCount: snapshots.length,
      latestGeneratedAt: serialiseDate(latestSnapshot?.generated_at),
      latestState: normaliseLabel(latestSnapshot?.state_label, "unknown"),
      topState: distribution[0]?.label || "unknown",
      avgFocusDepth: average(
        snapshots.map((snapshot) => Number(snapshot?.scores?.focus_depth)).filter(Number.isFinite)
      ),
      avgConfusionRisk: average(
        snapshots.map((snapshot) => Number(snapshot?.scores?.confusion_risk)).filter(Number.isFinite)
      ),
      avgFatigueRisk: average(
        snapshots.map((snapshot) => Number(snapshot?.scores?.fatigue_risk)).filter(Number.isFinite)
      ),
      avgInterruptibility: average(
        snapshots.map((snapshot) => Number(snapshot?.scores?.interruptibility)).filter(Number.isFinite)
      ),
      deepFocusRate: percentage(
        snapshots.filter((snapshot) => snapshot?.state_label === "deep_focus").length,
        snapshots.length
      ),
      harmfulConfusionRate: percentage(
        snapshots.filter((snapshot) => snapshot?.state_label === "harmful_confusion").length,
        snapshots.length
      ),
      fatigueRate: percentage(
        snapshots.filter((snapshot) => snapshot?.state_label === "fatigued").length,
        snapshots.length
      ),
    };

    const frictionHotspots = artifacts
      .map((artifact) => ({
        artifactId: normaliseLabel(artifact?.artifact_id, ""),
        artifactLabel: normaliseLabel(artifact?.artifact_label, "Unknown artifact"),
        frictionScore: round(Number(artifact?.friction_score || 0)),
        visits: Number(artifact?.visits || 0),
        revisits: Number(artifact?.revisits || 0),
        createdAt: serialiseDate(artifact?.created_at),
      }))
      .sort((left, right) => right.frictionScore - left.frictionScore)
      .slice(0, 6);

    const recentEvents = events.map((event) => ({
      id: `${event?._id || event?.created_at || Math.random()}`,
      timestamp: normaliseLabel(event?.timestamp, ""),
      createdAt: serialiseDate(event?.created_at),
      message: normaliseLabel(event?.message, ""),
    }));

    const alertTotals = {
      attentionResidue: residueEvents,
      preError: preErrorEvents,
      fatigue: fatigueEvents,
      confusionEpisodes: confusionEpisodes.length,
      handoffCapsules,
    };

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      source: {
        mongoConnected: true,
        liveConnected: liveDashboard.connected,
        liveUrl: LIVE_API_BASE,
        liveError: liveDashboard.error,
      },
      summary,
      live: {
        current: liveCurrent,
        teamRollup: liveDashboard.data?.team_rollup || null,
      },
      analytics: {
        stateDistribution: distribution,
        scoreAverages: buildScoreAverages(snapshots),
        scoreTimeline: timeline,
        stateTransitions: buildStateTransitions(snapshots),
        appBreakdown: buildAppBreakdown(snapshots),
        scoreExtremes: buildScoreExtremes(timeline),
        alertTotals,
        frictionHotspots,
        recentEvents,
        confusionEpisodes: confusionEpisodes.map((episode) => ({
          episodeId: normaliseLabel(episode?.episode_id, ""),
          status: normaliseLabel(episode?.status, "unknown"),
          peakConfusion: round(Number(episode?.peak_confusion || 0)),
          durationS: Number.isFinite(Number(episode?.duration_s))
            ? round(Number(episode.duration_s), 1)
            : null,
          activeApp: normaliseLabel(episode?.active_app, ""),
          activeWindow: normaliseLabel(episode?.active_window, ""),
          startedAt: serialiseDate(episode?.started_at),
          resolvedAt: serialiseDate(episode?.resolved_at),
        })),
        insights: buildInsights({
          liveCurrent,
          summary,
          distribution,
          hotspots: frictionHotspots,
          alertTotals,
        }),
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Unable to build dashboard payload.",
    });
  }
};

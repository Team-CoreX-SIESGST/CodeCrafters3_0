import { createHash } from "crypto";
import mongoose from "mongoose";
import { syncCognitiveGraphMaterialized } from "../services/cognitiveGraphSyncService.js";

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

const sortByDateDesc = (items, field) =>
  [...items].sort((left, right) => {
    const leftTime = safeDate(left?.[field])?.getTime() || 0;
    const rightTime = safeDate(right?.[field])?.getTime() || 0;
    return rightTime - leftTime;
  });

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

async function fetchLiveJson(path, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${LIVE_API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Live API responded with ${response.status} for ${path}`);
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMongoDashboardData(userId = "") {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      connected: false,
      userId: userId || null,
      snapshots: [],
      events: [],
      artifacts: [],
      confusionEpisodes: [],
      residueEvents: 0,
      preErrorEvents: 0,
      fatigueEvents: 0,
      handoffCapsules: 0,
    };
  }

  const filter = userId ? { user_id: userId } : {};
  const [
    snapshots,
    events,
    artifacts,
    confusionEpisodes,
    residueEvents,
    preErrorEvents,
    fatigueEvents,
    handoffCapsules,
  ] = await Promise.all([
    collection("snapshots").find(filter).sort({ generated_at: -1 }).toArray(),
    collection("events").find(filter).sort({ created_at: -1 }).limit(12).toArray(),
    collection("artifacts").find(filter).sort({ created_at: -1 }).limit(40).toArray(),
    collection("confusion_episodes").find(filter).sort({ started_at: -1 }).limit(8).toArray(),
    collection("attention_residue_events").countDocuments(filter),
    collection("pre_error_events").countDocuments(filter),
    collection("fatigue_events").countDocuments(filter),
    collection("handoff_capsules").countDocuments(filter),
  ]);

  return {
    connected: true,
    userId: userId || null,
    snapshots,
    events,
    artifacts,
    confusionEpisodes,
    residueEvents,
    preErrorEvents,
    fatigueEvents,
    handoffCapsules,
  };
}

function mapSnapshotCurrent(snapshot) {
  if (!snapshot) return null;

  return {
    generatedAt: serialiseDate(snapshot?.generated_at),
    stateLabel: normaliseLabel(snapshot?.state_label, "unknown"),
    classifierState: normaliseLabel(snapshot?.classifier_state, normaliseLabel(snapshot?.state_label, "unknown")),
    confidence: round(Number(snapshot?.state?.confidence || snapshot?.confidence || 0), 2),
    message: normaliseLabel(snapshot?.state?.message, ""),
    activeApp: normaliseLabel(snapshot?.active_app, ""),
    activeWindow: normaliseLabel(snapshot?.active_window, ""),
    blinkRate: Number.isFinite(Number(snapshot?.camera?.blink_rate_per_min))
      ? round(Number(snapshot.camera.blink_rate_per_min), 1)
      : null,
    perclos: Number.isFinite(Number(snapshot?.camera?.perclos))
      ? round(Number(snapshot.camera.perclos))
      : null,
    expression: normaliseLabel(snapshot?.camera?.expression, "neutral"),
    idleSeconds: Number.isFinite(Number(snapshot?.idle_seconds))
      ? round(Number(snapshot.idle_seconds), 1)
      : null,
    scores: snapshot?.scores || {},
    mlState: snapshot?.ml_state || null,
    artifact: snapshot?.artifact || null,
    detectionSource: normaliseLabel(
      snapshot?.state?.detection_source || snapshot?.detection_source,
      "cognitive_snapshots"
    ),
    onnx: snapshot?.core_features?.onnx_inference || null,
    interruptionBroker: snapshot?.core_features?.interruption_broker || null,
    timeTracker: snapshot?.time_tracker || null,
  };
}

async function fetchMongoGraphData() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return {
      connected: false,
      entities: [],
      relations: [],
      snapshots: [],
      entityCount: 0,
      relationCount: 0,
      snapshotCount: 0,
    };
  }

  const [entities, relations, snapshots, entityCount, relationCount, snapshotCount] = await Promise.all([
    collection("entities").find({}).sort({ updated_at: -1 }).toArray(),
    collection("relations").find({}).sort({ updated_at: -1 }).toArray(),
    collection("snapshots").find({}).sort({ generated_at: -1 }).toArray(),
    collection("entities").countDocuments({}),
    collection("relations").countDocuments({}),
    collection("snapshots").countDocuments({}),
  ]);

  return {
    connected: true,
    entities,
    relations,
    snapshots,
    entityCount,
    relationCount,
    snapshotCount,
  };
}

const hasNativeObserverGraph = (entities = []) =>
  entities.some((entity) => {
    const entityId = normaliseLabel(entity?.entity_id, "");
    const entityType = normaliseLabel(entity?.entity_type, "");
    return (
      entityId.startsWith("snapshot:") ||
      entityId.startsWith("session:") ||
      entityType === "session" ||
      entityType === "classifier_state"
    );
  });

const graphId = (kind, ...parts) => {
  const normalized = parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("||");
  const digest = createHash("sha1")
    .update(`${kind}::${normalized || "unknown"}`)
    .digest("hex")
    .slice(0, 16);
  return `${kind}:${digest}`;
};

function buildSnapshotGraphData(snapshots = []) {
  const entities = [];
  const relations = [];
  const seenEntities = new Set();
  const seenRelations = new Set();

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const generatedAt = snapshot?.generated_at || snapshot?.created_at || null;
    const stateLabel = normaliseLabel(snapshot?.state_label, "unknown");
    const activeApp = normaliseLabel(snapshot?.active_app, "Unknown");
    const activeWindow = normaliseLabel(snapshot?.active_window, "Unknown window");
    const snapshotId =
      normaliseLabel(snapshot?.snapshot_id, "") ||
      normaliseLabel(String(snapshot?._id || ""), "") ||
      normaliseLabel(String(generatedAt || ""), "");

    if (!snapshotId) continue;

    const snapshotNodeId = `mongo_snapshot:${snapshotId}`;
    const appNodeId = graphId("app", activeApp);
    const stateNodeId = graphId("state", stateLabel);
    const windowNodeId = graphId("window", activeApp, activeWindow, snapshot?.active_pid || 0);

    const upsertEntity = (entity) => {
      const id = normaliseLabel(entity?.entity_id, "");
      if (!id || seenEntities.has(id)) return;
      seenEntities.add(id);
      entities.push(entity);
    };

    const upsertRelation = (relation) => {
      const key = `${relation.from_id}->${relation.to_id}:${relation.relation_type}`;
      if (seenRelations.has(key)) return;
      seenRelations.add(key);
      relations.push(relation);
    };

    upsertEntity({
      entity_id: snapshotNodeId,
      entity_type: "snapshot",
      label: String(generatedAt || snapshotId),
      updated_at: generatedAt,
      state_label: stateLabel,
      active_app: activeApp,
      active_window: activeWindow,
      user_id: snapshot?.user_id || null,
      source_collection: "cognitive_snapshots",
    });

    upsertEntity({
      entity_id: appNodeId,
      entity_type: "app",
      label: activeApp,
      updated_at: generatedAt,
      source_collection: "cognitive_snapshots",
    });

    upsertEntity({
      entity_id: stateNodeId,
      entity_type: "state",
      label: stateLabel,
      updated_at: generatedAt,
      source_collection: "cognitive_snapshots",
    });

    upsertEntity({
      entity_id: windowNodeId,
      entity_type: "window",
      label: activeWindow,
      updated_at: generatedAt,
      source_collection: "cognitive_snapshots",
    });

    upsertRelation({
      from_id: snapshotNodeId,
      to_id: stateNodeId,
      relation_type: "SNAPSHOT_STATE",
      updated_at: generatedAt,
    });

    upsertRelation({
      from_id: snapshotNodeId,
      to_id: appNodeId,
      relation_type: "SNAPSHOT_APP",
      updated_at: generatedAt,
    });

    upsertRelation({
      from_id: appNodeId,
      to_id: windowNodeId,
      relation_type: "SNAPSHOT_WINDOW",
      updated_at: generatedAt,
    });
  }

  return { entities, relations };
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
    idleSeconds: Number.isFinite(Number(current?.idle_seconds))
      ? round(Number(current.idle_seconds), 1)
      : null,
    scores: current?.scores || {},
    mlState: current?.ml_state || null,
    artifact: current?.artifact || null,
    detectionSource: normaliseLabel(current?.state?.detection_source, "heuristic"),
    onnx: current?.core_features?.onnx_inference || null,
    interruptionBroker: current?.core_features?.interruption_broker || null,
    timeTracker: current?.time_tracker || null,
  };
}

function buildGraphPayload({
  mongoEntities = [],
  mongoRelations = [],
  mongoSnapshots = [],
  liveEntities = [],
  liveRelations = [],
} = {}) {
  const nativeObserverGraph = hasNativeObserverGraph(mongoEntities);
  const snapshotGraph = nativeObserverGraph ? { entities: [], relations: [] } : buildSnapshotGraphData(mongoSnapshots);
  const filteredMongoEntities = nativeObserverGraph
    ? (Array.isArray(mongoEntities) ? mongoEntities : []).filter((entity) => {
        const entityId = normaliseLabel(entity?.entity_id, "");
        return !entityId.startsWith("mongo_");
      })
    : Array.isArray(mongoEntities)
      ? mongoEntities
      : [];
  const filteredMongoRelations = nativeObserverGraph
    ? (Array.isArray(mongoRelations) ? mongoRelations : []).filter((relation) => {
        const fromId = normaliseLabel(relation?.from_id, "");
        const toId = normaliseLabel(relation?.to_id, "");
        return !fromId.startsWith("mongo_") && !toId.startsWith("mongo_");
      })
    : Array.isArray(mongoRelations)
      ? mongoRelations
      : [];
  const sortedEntities = sortByDateDesc(
    [
      ...filteredMongoEntities,
      ...snapshotGraph.entities,
      ...(Array.isArray(liveEntities) ? liveEntities : []),
    ],
    "updated_at"
  );
  const nodeMap = new Map();
  const dbNodeIds = new Set(
    [...filteredMongoEntities, ...snapshotGraph.entities]
      .map((entity) => normaliseLabel(entity?.entity_id, ""))
      .filter(Boolean)
  );
  const liveNodeIds = new Set(
    (Array.isArray(liveEntities) ? liveEntities : [])
      .map((entity) => normaliseLabel(entity?.entity_id, ""))
      .filter(Boolean)
  );

  for (const entity of sortedEntities) {
    const id = normaliseLabel(entity?.entity_id, "");
    if (!id || nodeMap.has(id)) continue;
    const inDb = dbNodeIds.has(id);
    const inLive = liveNodeIds.has(id);
    nodeMap.set(id, {
      id,
      label: normaliseLabel(entity?.label, id),
      type: normaliseLabel(entity?.entity_type, "default"),
      summary: normaliseLabel(
        entity?.summary || entity?.detail_text || entity?.description,
        ""
      ),
      updatedAt: serialiseDate(entity?.updated_at || entity?.generated_at || entity?.created_at),
      source: inDb && inLive ? "both" : inLive ? "live" : "db",
    });
  }

  const nodes = [...nodeMap.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = [];
  const seenLinks = new Set();
  const dbLinkIds = new Set(
    [...filteredMongoRelations, ...snapshotGraph.relations]
      .map((relation) => {
        const source = normaliseLabel(relation?.from_id, "");
        const target = normaliseLabel(relation?.to_id, "");
        const label = normaliseLabel(relation?.relation_type, "related_to");
        return source && target ? `${source}->${target}:${label}` : "";
      })
      .filter(Boolean)
  );
  const liveLinkIds = new Set(
    (Array.isArray(liveRelations) ? liveRelations : [])
      .map((relation) => {
        const source = normaliseLabel(relation?.from_id, "");
        const target = normaliseLabel(relation?.to_id, "");
        const label = normaliseLabel(relation?.relation_type, "related_to");
        return source && target ? `${source}->${target}:${label}` : "";
      })
      .filter(Boolean)
  );

  for (const relation of sortByDateDesc(
    [
      ...filteredMongoRelations,
      ...snapshotGraph.relations,
      ...(Array.isArray(liveRelations) ? liveRelations : []),
    ],
    "updated_at"
  )) {
    const source = normaliseLabel(relation?.from_id, "");
    const target = normaliseLabel(relation?.to_id, "");
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    const key = `${source}->${target}:${normaliseLabel(relation?.relation_type, "related_to")}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    const inDb = dbLinkIds.has(key);
    const inLive = liveLinkIds.has(key);
    links.push({
      source,
      target,
      label: normaliseLabel(relation?.relation_type, "related_to"),
      updatedAt: serialiseDate(relation?.updated_at || relation?.created_at),
      sourceKind: inDb && inLive ? "both" : inLive ? "live" : "db",
    });
  }

  const degreeCounts = new Map();
  for (const link of links) {
    degreeCounts.set(link.source, (degreeCounts.get(link.source) || 0) + 1);
    degreeCounts.set(link.target, (degreeCounts.get(link.target) || 0) + 1);
  }

  const enrichedNodes = nodes.map((node) => ({
    ...node,
    degree: degreeCounts.get(node.id) || 0,
  }));

  const typeCounts = nodes.reduce((accumulator, node) => {
    accumulator[node.type] = (accumulator[node.type] || 0) + 1;
    return accumulator;
  }, {});
  const sourceCounts = enrichedNodes.reduce(
    (accumulator, node) => {
      accumulator[node.source] = (accumulator[node.source] || 0) + 1;
      return accumulator;
    },
    { db: 0, live: 0, both: 0 }
  );
  const linkSourceCounts = links.reduce(
    (accumulator, link) => {
      accumulator[link.sourceKind] = (accumulator[link.sourceKind] || 0) + 1;
      return accumulator;
    },
    { db: 0, live: 0, both: 0 }
  );

  return {
    nodes: enrichedNodes,
    links,
    stats: {
      nodeCount: enrichedNodes.length,
      relationCount: links.length,
      nodeTypes: typeCounts,
      nodeSources: sourceCounts,
      relationSources: linkSourceCounts,
      dbNodeCount: dbNodeIds.size,
      liveNodeCount: liveNodeIds.size,
      dbRelationCount: dbLinkIds.size,
      liveRelationCount: liveLinkIds.size,
    },
  };
}

export const getCognitiveDashboard = async (_req, res) => {
  try {
    const mongoConnected = mongoose.connection.readyState === 1 && !!mongoose.connection.db;

    const [mongoData, initialMongoGraph] = await Promise.all([
      fetchMongoDashboardData(),
      fetchMongoGraphData(),
    ]);
    let mongoGraph = initialMongoGraph;
    let graphSync = {
      connected: mongoConnected,
      skipped: true,
      reason: mongoGraph.entityCount > 0 || mongoGraph.relationCount > 0 ? "graph_already_present" : "db_not_connected",
    };

    if (mongoConnected && mongoGraph.entityCount === 0 && mongoGraph.relationCount === 0) {
      graphSync = await syncCognitiveGraphMaterialized();
      mongoGraph = await fetchMongoGraphData();
    }

    const snapshots = sortByDateDesc(mongoData.snapshots, "generated_at");
    const events = mongoData.events;
    const artifacts = mongoData.artifacts;
    const confusionEpisodes = mongoData.confusionEpisodes;
    const residueEvents = mongoData.residueEvents;
    const preErrorEvents = mongoData.preErrorEvents;
    const fatigueEvents = mongoData.fatigueEvents;
    const handoffCapsules = mongoData.handoffCapsules;

    if (!snapshots.length && !mongoData.connected) {
      return res.status(503).json({
        ok: false,
        message: "MongoDB cognitive snapshots are not available.",
      });
    }

    const distribution = buildStateDistribution(snapshots);
    const latestSnapshot = snapshots[0] || null;
    const liveCurrent = mapSnapshotCurrent(latestSnapshot);
    const timeline = buildTimeline(snapshots);
    const graph = buildGraphPayload({
      mongoEntities: mongoGraph.entities,
      mongoRelations: mongoGraph.relations,
      mongoSnapshots: mongoGraph.snapshots,
    });

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
        mongoConnected,
        graphSync,
        liveConnected: false,
        liveUrl: LIVE_API_BASE,
        liveError: "Dashboard is using MongoDB-only analytics.",
        analyticsSource: "cognitive_snapshots",
        analyticsUserId: mongoData.userId,
      },
      summary,
      live: {
        current: liveCurrent,
        teamRollup: null,
        graph,
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

import mongoose from "mongoose";

const KNOWLEDGE_COLLECTIONS = [
  {
    name: "cognitive_snapshots",
    label: "snapshot",
    sort: { generated_at: -1 },
  },
  {
    name: "cognitive_events",
    label: "event",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_state_changes",
    label: "state_change",
    sort: { changed_at: -1 },
  },
  {
    name: "cognitive_artifacts",
    label: "artifact",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_capsules",
    label: "capsule",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_interruptions",
    label: "interruption",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_attention_residue_events",
    label: "attention_residue_event",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_pre_error_events",
    label: "pre_error_event",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_fatigue_events",
    label: "fatigue_event",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_confusion_episodes",
    label: "episode",
    sort: { started_at: -1, created_at: -1 },
  },
  {
    name: "cognitive_handoff_capsules",
    label: "handoff_capsule",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_sessions",
    label: "session",
    sort: { last_seen_at: -1, started_at: -1, created_at: -1 },
  },
  {
    name: "cognitive_activity_stream",
    label: "activity_stream",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_context_chunks",
    label: "context_chunk",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_focus_events",
    label: "focus_event",
    sort: { created_at: -1 },
  },
  {
    name: "cognitive_entities",
    label: "entity",
    sort: { updated_at: -1, created_at: -1 },
  },
  {
    name: "cognitive_relations",
    label: "relation",
    sort: { updated_at: -1, created_at: -1 },
  },
];

function getDb() {
  const db = mongoose.connection?.db;
  if (!db) {
    throw new Error("MongoDB is not connected");
  }
  return db;
}

function stringifyValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, inner]) => `${key}: ${stringifyValue(inner)}`)
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

function buildSnapshotRecord(doc) {
  const scores = Object.entries(doc.scores || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  const contextual = Object.entries(doc.contextual || {})
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  const text = [
    `Cognitive snapshot for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.generated_at)}.`,
    `State ${doc.state_label || "unknown"} with cursor state ${doc.cursor_state || "unknown"}.`,
    `Active app ${doc.active_app || "unknown"} and active window ${doc.active_window || "unknown"}.`,
    doc.artifact_label ? `Artifact ${doc.artifact_label}.` : "",
    scores ? `Scores: ${scores}.` : "",
    contextual ? `Context: ${contextual}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `snapshot:${doc._id}`,
    text,
    source: "cognitive_snapshots",
    collection: "cognitive_snapshots",
    recordType: "snapshot",
    userId: doc.user_id || "",
    stateLabel: doc.state_label || "",
    cursorState: doc.cursor_state || "",
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
    artifactLabel: doc.artifact_label || "",
    expression: doc.camera?.expression || "",
    detectionSource: doc.state?.detection_source || doc.detection_source || "",
    occurredAt: stringifyValue(doc.generated_at),
  };
}

function buildEventRecord(doc) {
  const text = [
    `Cognitive event for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    `Message: ${doc.message || "no message"}.`,
    doc.timestamp ? `Clock time ${doc.timestamp}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `event:${doc._id}`,
    text,
    source: "cognitive_events",
    collection: "cognitive_events",
    recordType: "event",
    userId: doc.user_id || "",
    message: doc.message || "",
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildStateChangeRecord(doc) {
  const text = [
    `State change for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.changed_at)}.`,
    `Transitioned from ${doc.from_state || "unknown"} to ${doc.to_state || "unknown"}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `state_change:${doc._id}`,
    text,
    source: "cognitive_state_changes",
    collection: "cognitive_state_changes",
    recordType: "state_change",
    userId: doc.user_id || "",
    fromState: doc.from_state || "",
    toState: doc.to_state || "",
    stateLabel: doc.to_state || "",
    occurredAt: stringifyValue(doc.changed_at),
  };
}

function buildArtifactRecord(doc) {
  const text = [
    `Cognitive artifact for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    `Artifact ${doc.artifact_label || "unknown artifact"} with friction score ${stringifyValue(doc.friction_score)}.`,
    doc.active_app ? `Active app ${doc.active_app}.` : "",
    doc.active_window ? `Active window ${doc.active_window}.` : "",
    doc.visits !== undefined ? `Visits ${doc.visits}.` : "",
    doc.revisits !== undefined ? `Revisits ${doc.revisits}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `artifact:${doc._id}`,
    text,
    source: "cognitive_artifacts",
    collection: "cognitive_artifacts",
    recordType: "artifact",
    userId: doc.user_id || "",
    artifactLabel: doc.artifact_label || "",
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildCapsuleRecord(doc, { collectionName, recordType }) {
  const text = [
    `${recordType === "handoff_capsule" ? "Handoff" : "Recovery"} capsule for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    doc.artifact_label ? `Artifact ${doc.artifact_label}.` : "",
    doc.current_goal ? `Current goal: ${doc.current_goal}.` : "",
    doc.likely_next_step ? `Likely next step: ${doc.likely_next_step}.` : "",
    doc.focus_forecast !== undefined ? `Focus forecast ${stringifyValue(doc.focus_forecast)}.` : "",
    doc.blocker_note ? `Blocker note: ${doc.blocker_note}.` : "",
    doc.type ? `Capsule type ${doc.type}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${recordType}:${doc._id}`,
    text,
    source: collectionName,
    collection: collectionName,
    recordType,
    userId: doc.user_id || "",
    artifactLabel: doc.artifact_label || "",
    type: doc.type || "",
    currentGoal: doc.current_goal || "",
    likelyNextStep: doc.likely_next_step || "",
    blockerNote: doc.blocker_note || "",
    focusForecast: stringifyValue(doc.focus_forecast),
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildInterruptionRecord(doc) {
  const itemSources = Array.isArray(doc.items)
    ? doc.items
        .map((item) => item?.source)
        .filter(Boolean)
        .join(", ")
    : "";
  const text = [
    `Interruption batch for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    doc.summary ? `Summary: ${doc.summary}.` : "",
    doc.count !== undefined ? `Count ${doc.count}.` : "",
    itemSources ? `Sources: ${itemSources}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `interruption:${doc._id}`,
    text,
    source: "cognitive_interruptions",
    collection: "cognitive_interruptions",
    recordType: "interruption",
    userId: doc.user_id || "",
    summary: doc.summary || "",
    count: stringifyValue(doc.count),
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildRiskEventRecord(doc, { collectionName, recordType, metricField, label }) {
  const metricValue = stringifyValue(doc[metricField]);
  const text = [
    `${label} for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    metricValue ? `${label} value ${metricValue}.` : "",
    doc.severity ? `Severity ${doc.severity}.` : "",
    doc.active_app ? `Active app ${doc.active_app}.` : "",
    doc.active_window ? `Active window ${doc.active_window}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${recordType}:${doc._id}`,
    text,
    source: collectionName,
    collection: collectionName,
    recordType,
    userId: doc.user_id || "",
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
    severity: doc.severity || "",
    metricValue,
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildConfusionEpisodeRecord(doc) {
  const text = [
    `Confusion episode for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.started_at || doc.created_at)}.`,
    `Status ${doc.status || "unknown"} with peak confusion ${stringifyValue(doc.peak_confusion)}.`,
    doc.duration_s !== undefined ? `Duration ${doc.duration_s} seconds.` : "",
    doc.active_app ? `Active app ${doc.active_app}.` : "",
    doc.active_window ? `Active window ${doc.active_window}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `episode:${doc._id}`,
    text,
    source: "cognitive_confusion_episodes",
    collection: "cognitive_confusion_episodes",
    recordType: "episode",
    userId: doc.user_id || "",
    status: doc.status || "",
    peakConfusion: stringifyValue(doc.peak_confusion),
    durationS: stringifyValue(doc.duration_s),
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
    occurredAt: stringifyValue(doc.started_at || doc.created_at),
  };
}

function buildSessionRecord(doc) {
  const text = [
    `Session ${doc.session_id || "unknown"} for user ${doc.user_id || "unknown"}.`,
    doc.started_at ? `Started at ${stringifyValue(doc.started_at)}.` : "",
    doc.last_seen_at ? `Last seen at ${stringifyValue(doc.last_seen_at)}.` : "",
    doc.state_label ? `Current state ${doc.state_label}.` : "",
    doc.active_app ? `Active app ${doc.active_app}.` : "",
    doc.active_window ? `Active window ${doc.active_window}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `session:${doc._id}`,
    text,
    source: "cognitive_sessions",
    collection: "cognitive_sessions",
    recordType: "session",
    userId: doc.user_id || "",
    sessionId: doc.session_id || "",
    stateLabel: doc.state_label || "",
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
    artifactId: doc.artifact_id || "",
    occurredAt: stringifyValue(doc.last_seen_at || doc.started_at || doc.created_at),
  };
}

function buildActivityStreamRecord(doc) {
  const scores = Object.entries(doc.metrics?.scores || {})
    .map(([key, value]) => `${key} ${stringifyValue(value)}`)
    .join(", ");
  const text = [
    `Activity stream entry for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    doc.session_id ? `Session ${doc.session_id}.` : "",
    doc.snapshot_id ? `Snapshot ${doc.snapshot_id}.` : "",
    scores ? `Scores: ${scores}.` : "",
    doc.metrics?.keyboard ? `Keyboard metrics: ${stringifyValue(doc.metrics.keyboard)}.` : "",
    doc.metrics?.mouse ? `Mouse metrics: ${stringifyValue(doc.metrics.mouse)}.` : "",
    doc.metrics?.camera ? `Camera metrics: ${stringifyValue(doc.metrics.camera)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `activity_stream:${doc._id}`,
    text,
    source: "cognitive_activity_stream",
    collection: "cognitive_activity_stream",
    recordType: "activity_stream",
    userId: doc.user_id || "",
    sessionId: doc.session_id || "",
    snapshotId: doc.snapshot_id || "",
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildContextChunkRecord(doc) {
  const chunkText = stringifyValue(doc.chunk_text);
  const text = [
    `Context chunk for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    doc.state_label ? `State ${doc.state_label}.` : "",
    chunkText,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `context_chunk:${doc._id}`,
    text,
    source: "cognitive_context_chunks",
    collection: "cognitive_context_chunks",
    recordType: "context_chunk",
    userId: doc.user_id || "",
    sessionId: doc.session_id || "",
    stateLabel: doc.state_label || "",
    chunkText,
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildFocusEventRecord(doc) {
  const fromContext = stringifyValue(doc.from_context);
  const toContext = stringifyValue(doc.to_context);
  const text = [
    `Focus transition for user ${doc.user_id || "unknown"} at ${stringifyValue(doc.created_at)}.`,
    doc.state_label ? `State ${doc.state_label}.` : "",
    doc.classifier_state ? `Classifier state ${doc.classifier_state}.` : "",
    fromContext ? `From: ${fromContext}.` : "",
    toContext ? `To: ${toContext}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `focus_event:${doc._id}`,
    text,
    source: "cognitive_focus_events",
    collection: "cognitive_focus_events",
    recordType: "focus_event",
    userId: doc.user_id || "",
    sessionId: doc.session_id || "",
    stateLabel: doc.state_label || "",
    classifierState: doc.classifier_state || "",
    fromContext,
    toContext,
    occurredAt: stringifyValue(doc.created_at),
  };
}

function buildEntityRecord(doc) {
  const extraFields = Object.entries(doc)
    .filter(([key]) => !["_id", "entity_id", "entity_type", "label", "created_at", "updated_at"].includes(key))
    .map(([key, value]) => `${key}: ${stringifyValue(value)}`)
    .filter(Boolean)
    .join("; ");

  const text = [
    `Cognitive entity ${doc.entity_type || "unknown"} labelled ${doc.label || "unknown"} with entity id ${doc.entity_id || "unknown"}.`,
    extraFields ? `Attributes: ${extraFields}.` : "",
    doc.updated_at ? `Updated at ${stringifyValue(doc.updated_at)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `entity:${doc._id}`,
    text,
    source: "cognitive_entities",
    collection: "cognitive_entities",
    recordType: "entity",
    userId: doc.user_id || "",
    entityId: doc.entity_id || "",
    entityType: doc.entity_type || "",
    label: doc.label || "",
    occurredAt: stringifyValue(doc.updated_at || doc.created_at),
  };
}

function buildRelationRecord(doc) {
  const text = [
    `Cognitive relation ${doc.relation_type || "unknown"} from ${doc.from_type || "unknown"} ${doc.from_id || "unknown"} to ${doc.to_type || "unknown"} ${doc.to_id || "unknown"}.`,
    doc.attributes ? `Attributes: ${stringifyValue(doc.attributes)}.` : "",
    doc.seen_count !== undefined ? `Seen count ${doc.seen_count}.` : "",
    doc.updated_at ? `Updated at ${stringifyValue(doc.updated_at)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: `relation:${doc._id}`,
    text,
    source: "cognitive_relations",
    collection: "cognitive_relations",
    recordType: "relation",
    relationType: doc.relation_type || "",
    fromId: doc.from_id || "",
    toId: doc.to_id || "",
    occurredAt: stringifyValue(doc.updated_at || doc.created_at),
  };
}

export function buildKnowledgeRecord(collectionName, doc) {
  switch (collectionName) {
    case "cognitive_snapshots":
      return buildSnapshotRecord(doc);
    case "cognitive_events":
      return buildEventRecord(doc);
    case "cognitive_state_changes":
      return buildStateChangeRecord(doc);
    case "cognitive_artifacts":
      return buildArtifactRecord(doc);
    case "cognitive_capsules":
      return buildCapsuleRecord(doc, {
        collectionName,
        recordType: "capsule",
      });
    case "cognitive_interruptions":
      return buildInterruptionRecord(doc);
    case "cognitive_attention_residue_events":
      return buildRiskEventRecord(doc, {
        collectionName,
        recordType: "attention_residue_event",
        metricField: "attention_residue",
        label: "Attention residue event",
      });
    case "cognitive_pre_error_events":
      return buildRiskEventRecord(doc, {
        collectionName,
        recordType: "pre_error_event",
        metricField: "pre_error_risk",
        label: "Pre-error risk event",
      });
    case "cognitive_fatigue_events":
      return buildRiskEventRecord(doc, {
        collectionName,
        recordType: "fatigue_event",
        metricField: "fatigue_risk",
        label: "Fatigue risk event",
      });
    case "cognitive_confusion_episodes":
      return buildConfusionEpisodeRecord(doc);
    case "cognitive_handoff_capsules":
      return buildCapsuleRecord(doc, {
        collectionName,
        recordType: "handoff_capsule",
      });
    case "cognitive_sessions":
      return buildSessionRecord(doc);
    case "cognitive_activity_stream":
      return buildActivityStreamRecord(doc);
    case "cognitive_context_chunks":
      return buildContextChunkRecord(doc);
    case "cognitive_focus_events":
      return buildFocusEventRecord(doc);
    case "cognitive_entities":
      return buildEntityRecord(doc);
    case "cognitive_relations":
      return buildRelationRecord(doc);
    default:
      return {
        id: `${collectionName}:${doc._id}`,
        text: stringifyValue(doc),
        source: collectionName,
        collection: collectionName,
        recordType: "generic",
        occurredAt: "",
      };
  }
}

export async function getCognitiveKnowledgeStats() {
  const db = getDb();
  const collections = {};
  let totalDocuments = 0;

  for (const config of KNOWLEDGE_COLLECTIONS) {
    const count = await db.collection(config.name).countDocuments();
    collections[config.name] = count;
    totalDocuments += count;
  }

  return {
    collections,
    totalDocuments,
  };
}

export async function* streamCognitiveKnowledgeRecords(batchSize = 100) {
  const db = getDb();

  for (const config of KNOWLEDGE_COLLECTIONS) {
    const cursor = db.collection(config.name).find({}).sort(config.sort);
    let batch = [];

    for await (const doc of cursor) {
      batch.push(buildKnowledgeRecord(config.name, doc));
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }

    if (batch.length > 0) {
      yield batch;
    }
  }
}

function tokenizeQuery(query) {
  return Array.from(
    new Set(
      String(query || "")
        .toLowerCase()
        .match(/[a-z0-9_.:-]+/g) || [],
    ),
  ).filter((token) => token.length >= 3);
}

function scoreText(text, tokens) {
  if (!text) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  }
  return score;
}

export async function searchCognitiveKnowledgeInMongo(
  query,
  { limit = 5, perCollection = 120 } = {},
) {
  const db = getDb();
  const tokens = tokenizeQuery(query);
  const ranked = [];
  const recent = [];

  for (const config of KNOWLEDGE_COLLECTIONS) {
    const docs = await db
      .collection(config.name)
      .find({})
      .sort(config.sort)
      .limit(perCollection)
      .toArray();

    for (const doc of docs) {
      const record = buildKnowledgeRecord(config.name, doc);
      const score = scoreText(record.text, tokens);
      const candidate = {
        id: record.id,
        score,
        metadata: {
          ...record,
          source: record.source,
          text: record.text,
          content: record.text,
        },
      };
      if (score > 0) {
        ranked.push(candidate);
      } else {
        recent.push(candidate);
      }
    }
  }

  if (ranked.length === 0) {
    return recent.slice(0, limit);
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked.slice(0, limit);
}

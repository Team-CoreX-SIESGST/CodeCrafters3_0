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
    activeApp: doc.active_app || "",
    activeWindow: doc.active_window || "",
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
          source: record.source,
          text: record.text,
          content: record.text,
          collection: record.collection,
          recordType: record.recordType,
          occurredAt: record.occurredAt,
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

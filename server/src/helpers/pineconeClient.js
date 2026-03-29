// src/helpers/pineconeClient.js
import { Pinecone } from "@pinecone-database/pinecone";

let _client = null;
let _index = null;

function isUsableHost(host) {
  return Boolean(
    host &&
      typeof host === "string" &&
      host.trim() &&
      !host.includes("your-index-host"),
  );
}

function getPineconeClient() {
  if (!_client) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey || apiKey === "your_pinecone_api_key_here") {
      throw new Error(
        "PINECONE_API_KEY is not configured. Please set it in server/.env"
      );
    }
    _client = new Pinecone({ apiKey });
  }
  return _client;
}

export function getPineconeIndex() {
  if (!_index) {
    const client = getPineconeClient();
    const indexName = process.env.PINECONE_INDEX_NAME || "luna-knowledge";
    const host = process.env.PINECONE_INDEX_HOST;
    _index = isUsableHost(host)
      ? client.index({ name: indexName, host })
      : client.index({ name: indexName });
  }
  return _index;
}

/**
 * Upsert vectors into Pinecone.
 * @param {Array<{ id: string, values: number[], metadata: object }>} vectors
 * @param {string} [namespace]
 */
export async function upsertVectors(vectors, namespace) {
  const index = getPineconeIndex();
  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
  await index.namespace(ns).upsert({ records: vectors });
}

export async function upsertRecords(records, namespace) {
  const index = getPineconeIndex();
  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
  await index.namespace(ns).upsertRecords({ records });
}

export async function clearNamespace(namespace) {
  const index = getPineconeIndex();
  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
  await index.deleteAll({ namespace: ns });
}

/**
 * Query Pinecone for the top-K nearest neighbours.
 * @param {number[]} embedding  - query embedding vector
 * @param {number}   topK       - number of results to return
 * @param {object}   [filter]   - optional metadata filter
 * @param {string}   [namespace]
 * @returns {Promise<Array<{ id, score, metadata }>>}
 */
export async function queryPinecone(embedding, topK = 5, filter = undefined, namespace) {
  const index = getPineconeIndex();
  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";

  const response = await index.namespace(ns).query({
    vector: embedding,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });

  return (response.matches || []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata || {},
  }));
}

export async function searchPineconeByText(queryText, topK = 5, filter = undefined, namespace) {
  const index = getPineconeIndex();
  const ns = namespace || process.env.PINECONE_NAMESPACE || "default";
  const response = await index.namespace(ns).searchRecords({
    query: {
      inputs: { text: String(queryText).trim() },
      topK,
      ...(filter ? { filter } : {}),
    },
    fields: [
      "text",
      "source",
      "collection",
      "recordType",
      "occurredAt",
      "userId",
      "sessionId",
      "snapshotId",
      "stateLabel",
      "cursorState",
      "activeApp",
      "activeWindow",
      "artifactLabel",
      "expression",
      "detectionSource",
      "entityType",
      "entityId",
      "relationType",
      "label",
      "message",
      "status",
      "severity",
      "type",
      "count",
      "fromState",
      "toState",
      "currentGoal",
      "likelyNextStep",
      "blockerNote",
      "focusForecast",
      "classifierState",
      "fromContext",
      "toContext",
      "chunkText",
      "peakConfusion",
      "durationS",
      "summary",
    ],
  });

  return (response?.result?.hits || []).map((hit) => {
    const fields = hit?.fields && typeof hit.fields === "object" ? hit.fields : {};
    return {
      id: hit?._id,
      score: hit?._score,
      metadata: {
        ...fields,
        content: typeof fields.text === "string" ? fields.text : "",
      },
    };
  });
}

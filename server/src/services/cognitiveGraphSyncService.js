import { createHash } from "crypto";
import mongoose from "mongoose";

const GRAPH_SYNC_META_KEY = "graph_materialization";

const normaliseLabel = (value, fallback = "") => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim();
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

const collection = (name) => mongoose.connection.db.collection(`cognitive_${name}`);
const metaCollection = () => mongoose.connection.db.collection("cognitive_sync_meta");

async function detectNativeObserverGraph() {
  const [entityCount, relationCount, nativeEntityCount] = await Promise.all([
    collection("entities").countDocuments({}),
    collection("relations").countDocuments({}),
    collection("entities").countDocuments({
      $or: [
        { entity_type: { $in: ["session", "classifier_state"] } },
        { entity_id: /^snapshot:/ },
        { entity_id: /^session:/ },
      ],
    }),
  ]);

  return {
    entityCount,
    relationCount,
    nativeEntityCount,
    available: entityCount > 0 && relationCount > 0 && nativeEntityCount > 0,
  };
}

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

const pickFirstString = (...values) =>
  values.find((value) => typeof value === "string" && value.trim())?.trim() || "";

const buildSummary = (...parts) => parts.filter(Boolean).join(" | ");

const compactObject = (input) =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    })
  );

function upsertEntity(store, entity) {
  const entityId = normaliseLabel(entity?.entity_id, "");
  if (!entityId) return;

  const previous = store.get(entityId) || {};
  store.set(entityId, {
    ...previous,
    ...compactObject(entity),
    entity_id: entityId,
    created_at: previous.created_at || serialiseDate(entity?.created_at) || serialiseDate(entity?.updated_at),
    updated_at: serialiseDate(entity?.updated_at) || previous.updated_at || serialiseDate(entity?.created_at),
  });
}

function upsertRelation(store, relation) {
  const fromId = normaliseLabel(relation?.from_id, "");
  const toId = normaliseLabel(relation?.to_id, "");
  const relationType = normaliseLabel(relation?.relation_type, "");
  if (!fromId || !toId || !relationType) return;

  const key = `${fromId}->${toId}:${relationType}`;
  const previous = store.get(key) || {};
  store.set(key, {
    ...previous,
    ...compactObject(relation),
    from_id: fromId,
    to_id: toId,
    relation_type: relationType,
    created_at: previous.created_at || serialiseDate(relation?.created_at) || serialiseDate(relation?.updated_at),
    updated_at: serialiseDate(relation?.updated_at) || previous.updated_at || serialiseDate(relation?.created_at),
  });
}

function ensureUserEntity(entityStore, userId, occurredAt, sourceCollection) {
  const normalizedUser = normaliseLabel(userId, "");
  if (!normalizedUser) return "";

  const userNodeId = graphId("user", normalizedUser);
  upsertEntity(entityStore, {
    entity_id: userNodeId,
    entity_type: "user",
    label: normalizedUser,
    user_id: normalizedUser,
    updated_at: occurredAt,
    source_collection: sourceCollection,
    summary: `User ${normalizedUser}`,
  });

  return userNodeId;
}

function materializeSnapshot(snapshot, entityStore, relationStore) {
  const occurredAt = snapshot?.generated_at || snapshot?.created_at || null;
  const snapshotId =
    normaliseLabel(snapshot?.snapshot_id, "") ||
    normaliseLabel(String(snapshot?._id || ""), "") ||
    serialiseDate(occurredAt);
  if (!snapshotId) return;

  const userId = normaliseLabel(snapshot?.user_id, "");
  const stateLabel = normaliseLabel(snapshot?.state_label, "unknown");
  const activeApp = normaliseLabel(snapshot?.active_app, "Unknown");
  const activeWindow = normaliseLabel(snapshot?.active_window, "Unknown window");
  const cursorState = normaliseLabel(snapshot?.cursor_state, "");
  const expression = normaliseLabel(snapshot?.camera?.expression, "");
  const artifactLabel = pickFirstString(
    snapshot?.artifact_label,
    snapshot?.artifact?.label,
    snapshot?.artifact?.artifact_label
  );
  const detectionSource = normaliseLabel(
    snapshot?.state?.detection_source || snapshot?.detection_source,
    ""
  );
  const projectLabel = pickFirstString(
    snapshot?.time_tracker?.project_name,
    snapshot?.time_tracker?.project,
    snapshot?.time_tracker?.workspace,
    snapshot?.contextual?.workspace_name
  );
  const taskLabel = pickFirstString(
    snapshot?.time_tracker?.task_name,
    snapshot?.time_tracker?.task,
    snapshot?.time_tracker?.document,
    snapshot?.time_tracker?.file_name,
    snapshot?.contextual?.task_name
  );

  const snapshotNodeId = `mongo_snapshot:${snapshotId}`;
  const userNodeId = ensureUserEntity(entityStore, userId, occurredAt, "cognitive_snapshots");
  const appNodeId = graphId("app", activeApp);
  const windowNodeId = graphId("window", activeApp, activeWindow, snapshot?.active_pid || 0);
  const stateNodeId = graphId("state", stateLabel);

  upsertEntity(entityStore, {
    entity_id: snapshotNodeId,
    entity_type: "snapshot",
    label: `${stateLabel.replace(/_/g, " ")} @ ${serialiseDate(occurredAt) || snapshotId}`,
    user_id: userId || null,
    updated_at: occurredAt,
    source_collection: "cognitive_snapshots",
    active_app: activeApp,
    active_window: activeWindow,
    state_label: stateLabel,
    cursor_state: cursorState || null,
    expression: expression || null,
    artifact_label: artifactLabel || null,
    summary: buildSummary(
      activeApp,
      activeWindow,
      stateLabel.replace(/_/g, " "),
      artifactLabel && `artifact ${artifactLabel}`
    ),
    attributes: compactObject({
      confidence: snapshot?.state?.confidence ?? snapshot?.confidence,
      scores: snapshot?.scores || {},
      contextual: snapshot?.contextual || {},
      time_tracker: snapshot?.time_tracker || {},
      detection_source: detectionSource,
      idle_seconds: snapshot?.idle_seconds,
      blink_rate_per_min: snapshot?.camera?.blink_rate_per_min,
      perclos: snapshot?.camera?.perclos,
    }),
  });

  upsertEntity(entityStore, {
    entity_id: appNodeId,
    entity_type: "app",
    label: activeApp,
    updated_at: occurredAt,
    source_collection: "cognitive_snapshots",
    summary: `Application ${activeApp}`,
  });

  upsertEntity(entityStore, {
    entity_id: windowNodeId,
    entity_type: "window",
    label: activeWindow,
    updated_at: occurredAt,
    source_collection: "cognitive_snapshots",
    active_app: activeApp,
    summary: buildSummary(activeApp, activeWindow),
  });

  upsertEntity(entityStore, {
    entity_id: stateNodeId,
    entity_type: "state",
    label: stateLabel,
    updated_at: occurredAt,
    source_collection: "cognitive_snapshots",
    summary: `User state ${stateLabel.replace(/_/g, " ")}`,
  });

  if (cursorState) {
    const cursorNodeId = graphId("cursor_state", cursorState);
    upsertEntity(entityStore, {
      entity_id: cursorNodeId,
      entity_type: "cursor_state",
      label: cursorState,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      summary: `Cursor state ${cursorState}`,
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: cursorNodeId,
      from_type: "snapshot",
      to_type: "cursor_state",
      relation_type: "SNAPSHOT_CURSOR_STATE",
      updated_at: occurredAt,
    });
  }

  if (expression) {
    const expressionNodeId = graphId("expression", expression);
    upsertEntity(entityStore, {
      entity_id: expressionNodeId,
      entity_type: "expression",
      label: expression,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      summary: `Expression ${expression}`,
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: expressionNodeId,
      from_type: "snapshot",
      to_type: "expression",
      relation_type: "SNAPSHOT_EXPRESSION",
      updated_at: occurredAt,
    });
  }

  if (artifactLabel) {
    const artifactNodeId = graphId("artifact", artifactLabel, activeApp, activeWindow);
    upsertEntity(entityStore, {
      entity_id: artifactNodeId,
      entity_type: "artifact",
      label: artifactLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      active_app: activeApp,
      active_window: activeWindow,
      summary: buildSummary("artifact", artifactLabel, activeWindow),
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: artifactNodeId,
      from_type: "snapshot",
      to_type: "artifact",
      relation_type: "SNAPSHOT_ARTIFACT",
      updated_at: occurredAt,
    });
  }

  if (detectionSource) {
    const detectionNodeId = graphId("detection_source", detectionSource);
    upsertEntity(entityStore, {
      entity_id: detectionNodeId,
      entity_type: "detection_source",
      label: detectionSource,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      summary: `Detection source ${detectionSource}`,
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: detectionNodeId,
      from_type: "snapshot",
      to_type: "detection_source",
      relation_type: "SNAPSHOT_DETECTION_SOURCE",
      updated_at: occurredAt,
    });
  }

  if (projectLabel) {
    const projectNodeId = graphId("project", projectLabel);
    upsertEntity(entityStore, {
      entity_id: projectNodeId,
      entity_type: "project",
      label: projectLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      summary: `Project ${projectLabel}`,
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: projectNodeId,
      from_type: "snapshot",
      to_type: "project",
      relation_type: "SNAPSHOT_PROJECT",
      updated_at: occurredAt,
    });
  }

  if (taskLabel) {
    const taskNodeId = graphId("task", taskLabel);
    upsertEntity(entityStore, {
      entity_id: taskNodeId,
      entity_type: "task",
      label: taskLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_snapshots",
      summary: `Task ${taskLabel}`,
    });
    upsertRelation(relationStore, {
      from_id: snapshotNodeId,
      to_id: taskNodeId,
      from_type: "snapshot",
      to_type: "task",
      relation_type: "SNAPSHOT_TASK",
      updated_at: occurredAt,
    });
  }

  if (userNodeId) {
    upsertRelation(relationStore, {
      from_id: userNodeId,
      to_id: snapshotNodeId,
      from_type: "user",
      to_type: "snapshot",
      relation_type: "USER_SNAPSHOT",
      updated_at: occurredAt,
    });
  }

  upsertRelation(relationStore, {
    from_id: snapshotNodeId,
    to_id: stateNodeId,
    from_type: "snapshot",
    to_type: "state",
    relation_type: "SNAPSHOT_STATE",
    updated_at: occurredAt,
  });
  upsertRelation(relationStore, {
    from_id: snapshotNodeId,
    to_id: appNodeId,
    from_type: "snapshot",
    to_type: "app",
    relation_type: "SNAPSHOT_APP",
    updated_at: occurredAt,
  });
  upsertRelation(relationStore, {
    from_id: snapshotNodeId,
    to_id: windowNodeId,
    from_type: "snapshot",
    to_type: "window",
    relation_type: "SNAPSHOT_WINDOW",
    updated_at: occurredAt,
  });
  upsertRelation(relationStore, {
    from_id: appNodeId,
    to_id: windowNodeId,
    from_type: "app",
    to_type: "window",
    relation_type: "APP_WINDOW",
    updated_at: occurredAt,
  });
}

function materializeEvent(event, entityStore, relationStore) {
  const occurredAt = event?.created_at || null;
  const eventId = normaliseLabel(String(event?._id || ""), "");
  if (!eventId) return;

  const userId = normaliseLabel(event?.user_id, "");
  const eventNodeId = `mongo_event:${eventId}`;
  const userNodeId = ensureUserEntity(entityStore, userId, occurredAt, "cognitive_events");
  const appLabel = normaliseLabel(event?.active_app, "");
  const windowLabel = normaliseLabel(event?.active_window, "");

  upsertEntity(entityStore, {
    entity_id: eventNodeId,
    entity_type: "event",
    label: normaliseLabel(event?.message, "cognitive event").slice(0, 80),
    updated_at: occurredAt,
    source_collection: "cognitive_events",
    user_id: userId || null,
    timestamp: normaliseLabel(event?.timestamp, ""),
    summary: buildSummary(normaliseLabel(event?.message, ""), normaliseLabel(event?.timestamp, "")),
    attributes: compactObject({
      raw_message: normaliseLabel(event?.message, ""),
      active_app: appLabel,
      active_window: windowLabel,
      event_type: normaliseLabel(event?.event_type, ""),
    }),
  });

  if (userNodeId) {
    upsertRelation(relationStore, {
      from_id: userNodeId,
      to_id: eventNodeId,
      from_type: "user",
      to_type: "event",
      relation_type: "USER_EVENT",
      updated_at: occurredAt,
    });
  }

  if (appLabel) {
    const appNodeId = graphId("app", appLabel);
    upsertEntity(entityStore, {
      entity_id: appNodeId,
      entity_type: "app",
      label: appLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_events",
      summary: `Application ${appLabel}`,
    });
    upsertRelation(relationStore, {
      from_id: eventNodeId,
      to_id: appNodeId,
      from_type: "event",
      to_type: "app",
      relation_type: "EVENT_APP",
      updated_at: occurredAt,
    });

    if (windowLabel) {
      const windowNodeId = graphId("window", appLabel, windowLabel);
      upsertEntity(entityStore, {
        entity_id: windowNodeId,
        entity_type: "window",
        label: windowLabel,
        updated_at: occurredAt,
        source_collection: "cognitive_events",
        active_app: appLabel,
        summary: buildSummary(appLabel, windowLabel),
      });
      upsertRelation(relationStore, {
        from_id: eventNodeId,
        to_id: windowNodeId,
        from_type: "event",
        to_type: "window",
        relation_type: "EVENT_WINDOW",
        updated_at: occurredAt,
      });
    }
  }
}

function materializeArtifact(artifact, entityStore, relationStore) {
  const occurredAt = artifact?.created_at || null;
  const artifactId =
    normaliseLabel(artifact?.artifact_id, "") ||
    normaliseLabel(String(artifact?._id || ""), "");
  if (!artifactId) return;

  const userId = normaliseLabel(artifact?.user_id, "");
  const artifactLabel = normaliseLabel(artifact?.artifact_label, "artifact");
  const appLabel = normaliseLabel(artifact?.active_app, "");
  const windowLabel = normaliseLabel(artifact?.active_window, "");
  const artifactNodeId = graphId("artifact", artifactId, artifactLabel);
  const userNodeId = ensureUserEntity(entityStore, userId, occurredAt, "cognitive_artifacts");

  upsertEntity(entityStore, {
    entity_id: artifactNodeId,
    entity_type: "artifact",
    label: artifactLabel,
    updated_at: occurredAt,
    source_collection: "cognitive_artifacts",
    user_id: userId || null,
    summary: buildSummary(
      artifactLabel,
      Number.isFinite(Number(artifact?.friction_score)) ? `friction ${artifact.friction_score}` : "",
      Number.isFinite(Number(artifact?.visits)) ? `visits ${artifact.visits}` : ""
    ),
    attributes: compactObject({
      artifact_id: artifactId,
      friction_score: artifact?.friction_score,
      visits: artifact?.visits,
      revisits: artifact?.revisits,
      active_app: appLabel,
      active_window: windowLabel,
    }),
  });

  if (userNodeId) {
    upsertRelation(relationStore, {
      from_id: userNodeId,
      to_id: artifactNodeId,
      from_type: "user",
      to_type: "artifact",
      relation_type: "USER_ARTIFACT",
      updated_at: occurredAt,
    });
  }

  if (appLabel) {
    const appNodeId = graphId("app", appLabel);
    upsertEntity(entityStore, {
      entity_id: appNodeId,
      entity_type: "app",
      label: appLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_artifacts",
      summary: `Application ${appLabel}`,
    });
    upsertRelation(relationStore, {
      from_id: artifactNodeId,
      to_id: appNodeId,
      from_type: "artifact",
      to_type: "app",
      relation_type: "ARTIFACT_APP",
      updated_at: occurredAt,
    });

    if (windowLabel) {
      const windowNodeId = graphId("window", appLabel, windowLabel);
      upsertEntity(entityStore, {
        entity_id: windowNodeId,
        entity_type: "window",
        label: windowLabel,
        updated_at: occurredAt,
        source_collection: "cognitive_artifacts",
        active_app: appLabel,
        summary: buildSummary(appLabel, windowLabel),
      });
      upsertRelation(relationStore, {
        from_id: artifactNodeId,
        to_id: windowNodeId,
        from_type: "artifact",
        to_type: "window",
        relation_type: "ARTIFACT_WINDOW",
        updated_at: occurredAt,
      });
    }
  }
}

function materializeConfusionEpisode(episode, entityStore, relationStore) {
  const occurredAt = episode?.started_at || episode?.created_at || null;
  const episodeId =
    normaliseLabel(episode?.episode_id, "") ||
    normaliseLabel(String(episode?._id || ""), "");
  if (!episodeId) return;

  const userId = normaliseLabel(episode?.user_id, "");
  const appLabel = normaliseLabel(episode?.active_app, "");
  const windowLabel = normaliseLabel(episode?.active_window, "");
  const status = normaliseLabel(episode?.status, "");
  const episodeNodeId = graphId("episode", episodeId);
  const userNodeId = ensureUserEntity(entityStore, userId, occurredAt, "cognitive_confusion_episodes");

  upsertEntity(entityStore, {
    entity_id: episodeNodeId,
    entity_type: "episode",
    label: status || "confusion episode",
    updated_at: episode?.resolved_at || occurredAt,
    source_collection: "cognitive_confusion_episodes",
    user_id: userId || null,
    summary: buildSummary(
      status || "confusion episode",
      Number.isFinite(Number(episode?.peak_confusion)) ? `peak ${episode.peak_confusion}` : "",
      Number.isFinite(Number(episode?.duration_s)) ? `${episode.duration_s}s` : ""
    ),
    attributes: compactObject({
      episode_id: episodeId,
      peak_confusion: episode?.peak_confusion,
      duration_s: episode?.duration_s,
      started_at: serialiseDate(episode?.started_at),
      resolved_at: serialiseDate(episode?.resolved_at),
      active_app: appLabel,
      active_window: windowLabel,
    }),
  });

  if (userNodeId) {
    upsertRelation(relationStore, {
      from_id: userNodeId,
      to_id: episodeNodeId,
      from_type: "user",
      to_type: "episode",
      relation_type: "USER_EPISODE",
      updated_at: episode?.resolved_at || occurredAt,
    });
  }

  if (appLabel) {
    const appNodeId = graphId("app", appLabel);
    upsertEntity(entityStore, {
      entity_id: appNodeId,
      entity_type: "app",
      label: appLabel,
      updated_at: occurredAt,
      source_collection: "cognitive_confusion_episodes",
      summary: `Application ${appLabel}`,
    });
    upsertRelation(relationStore, {
      from_id: episodeNodeId,
      to_id: appNodeId,
      from_type: "episode",
      to_type: "app",
      relation_type: "EPISODE_APP",
      updated_at: episode?.resolved_at || occurredAt,
    });

    if (windowLabel) {
      const windowNodeId = graphId("window", appLabel, windowLabel);
      upsertEntity(entityStore, {
        entity_id: windowNodeId,
        entity_type: "window",
        label: windowLabel,
        updated_at: occurredAt,
        source_collection: "cognitive_confusion_episodes",
        active_app: appLabel,
        summary: buildSummary(appLabel, windowLabel),
      });
      upsertRelation(relationStore, {
        from_id: episodeNodeId,
        to_id: windowNodeId,
        from_type: "episode",
        to_type: "window",
        relation_type: "EPISODE_WINDOW",
        updated_at: episode?.resolved_at || occurredAt,
      });
    }
  }

  if (status) {
    const statusNodeId = graphId("episode_status", status);
    upsertEntity(entityStore, {
      entity_id: statusNodeId,
      entity_type: "episode_status",
      label: status,
      updated_at: occurredAt,
      source_collection: "cognitive_confusion_episodes",
      summary: `Episode status ${status}`,
    });
    upsertRelation(relationStore, {
      from_id: episodeNodeId,
      to_id: statusNodeId,
      from_type: "episode",
      to_type: "episode_status",
      relation_type: "EPISODE_STATUS",
      updated_at: episode?.resolved_at || occurredAt,
    });
  }
}

export async function syncCognitiveGraphMaterialized({
  force = false,
  freshnessMs = 120000,
  maxSnapshots = 1200,
  maxEvents = 400,
  maxArtifacts = 400,
  maxConfusionEpisodes = 240,
} = {}) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return { connected: false, skipped: true, reason: "db_not_connected" };
  }

  const meta = await metaCollection().findOne({ key: GRAPH_SYNC_META_KEY });
  const lastUpdatedAt = safeDate(meta?.updated_at);
  if (!force && lastUpdatedAt && Date.now() - lastUpdatedAt.getTime() < freshnessMs) {
    return {
      connected: true,
      skipped: true,
      reason: "fresh",
      updatedAt: lastUpdatedAt.toISOString(),
    };
  }

  const nativeGraph = await detectNativeObserverGraph();
  if (nativeGraph.available) {
    return {
      connected: true,
      skipped: true,
      reason: "native_graph_present",
      stats: nativeGraph,
    };
  }

  const [snapshots, events, artifacts, confusionEpisodes] = await Promise.all([
    collection("snapshots").find({}).sort({ generated_at: -1 }).limit(maxSnapshots).toArray(),
    collection("events").find({}).sort({ created_at: -1 }).limit(maxEvents).toArray(),
    collection("artifacts").find({}).sort({ created_at: -1 }).limit(maxArtifacts).toArray(),
    collection("confusion_episodes").find({}).sort({ started_at: -1 }).limit(maxConfusionEpisodes).toArray(),
  ]);

  const entityStore = new Map();
  const relationStore = new Map();

  snapshots.forEach((snapshot) => materializeSnapshot(snapshot, entityStore, relationStore));
  events.forEach((event) => materializeEvent(event, entityStore, relationStore));
  artifacts.forEach((artifact) => materializeArtifact(artifact, entityStore, relationStore));
  confusionEpisodes.forEach((episode) =>
    materializeConfusionEpisode(episode, entityStore, relationStore)
  );

  const entities = [...entityStore.values()];
  const relations = [...relationStore.values()];

  if (entities.length > 0) {
    await collection("entities").bulkWrite(
      entities.map((entity) => {
        const { created_at, ...entityForSet } = entity;
        return {
          updateOne: {
            filter: { entity_id: entity.entity_id },
            update: {
              $set: entityForSet,
              $setOnInsert: {
                created_at: created_at || entity.updated_at || new Date().toISOString(),
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
  }

  if (relations.length > 0) {
    await collection("relations").bulkWrite(
      relations.map((relation) => {
        const { created_at, ...relationForSet } = relation;
        return {
          updateOne: {
            filter: {
              from_id: relation.from_id,
              to_id: relation.to_id,
              relation_type: relation.relation_type,
            },
            update: {
              $set: relationForSet,
              $setOnInsert: {
                created_at: created_at || relation.updated_at || new Date().toISOString(),
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );
  }

  const updatedAt = new Date().toISOString();
  await metaCollection().updateOne(
    { key: GRAPH_SYNC_META_KEY },
    {
      $set: {
        key: GRAPH_SYNC_META_KEY,
        updated_at: updatedAt,
        stats: {
          snapshotCount: snapshots.length,
          eventCount: events.length,
          artifactCount: artifacts.length,
          confusionEpisodeCount: confusionEpisodes.length,
          entityCount: entities.length,
          relationCount: relations.length,
        },
      },
    },
    { upsert: true }
  );

  return {
    connected: true,
    skipped: false,
    updatedAt,
    stats: {
      snapshotCount: snapshots.length,
      eventCount: events.length,
      artifactCount: artifacts.length,
      confusionEpisodeCount: confusionEpisodes.length,
      entityCount: entities.length,
      relationCount: relations.length,
    },
  };
}

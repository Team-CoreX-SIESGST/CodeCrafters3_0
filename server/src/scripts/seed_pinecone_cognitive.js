import "../config/env.js";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import { syncCognitiveGraphMaterialized } from "../services/cognitiveGraphSyncService.js";
import { streamCognitiveKnowledgeRecords } from "../services/cognitiveKnowledgeService.js";
import { clearNamespace, getPineconeIndex, upsertRecords } from "../helpers/pineconeClient.js";

const namespace = process.env.PINECONE_NAMESPACE || "default";
const batchSize = 90;
const rateLimitDelayMs = 65_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function upsertWithRetry(records) {
  for (;;) {
    try {
      await upsertRecords(records, namespace);
      return;
    } catch (error) {
      const message = String(error?.message || "");
      if (!message.includes("RESOURCE_EXHAUSTED") && !message.includes("429")) {
        throw error;
      }
      console.log(`Rate limit reached. Waiting ${Math.round(rateLimitDelayMs / 1000)}s before retry...`);
      await sleep(rateLimitDelayMs);
    }
  }
}

async function seed() {
  console.log("Starting cognitive Pinecone seed...");
  await connectDB();
  const graphSync = await syncCognitiveGraphMaterialized({ force: true });
  console.log("Graph materialization sync:", graphSync);

  const existingStats = await getPineconeIndex().describeIndexStats();
  const existingCount = existingStats.namespaces?.[namespace]?.recordCount || 0;
  console.log(`Existing Pinecone records in namespace ${namespace}: ${existingCount}`);
  console.log(`Clearing Pinecone namespace ${namespace} before reseeding...`);
  await clearNamespace(namespace);

  let upserted = 0;
  let batches = 0;

  try {
    for await (const batch of streamCognitiveKnowledgeRecords(batchSize)) {
      await upsertWithRetry(batch);
      upserted += batch.length;
      batches += 1;
      console.log(`Batch ${batches}: upserted ${batch.length} records (new total ${upserted})`);
    }

    const finalStats = await getPineconeIndex().describeIndexStats();
    const finalCount = finalStats.namespaces?.[namespace]?.recordCount || 0;
    console.log(`Seed complete. Namespace=${namespace}, upserted=${upserted}, Pinecone total=${finalCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch(async (error) => {
  console.error("Cognitive Pinecone seeding failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

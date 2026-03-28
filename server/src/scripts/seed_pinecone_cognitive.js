import "../config/env.js";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import { streamCognitiveKnowledgeRecords } from "../services/cognitiveKnowledgeService.js";
import { getPineconeIndex, upsertRecords } from "../helpers/pineconeClient.js";

const namespace = process.env.PINECONE_NAMESPACE || "default";
const batchSize = 90;
const rateLimitDelayMs = 65_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAlreadyIndexedCount() {
  const stats = await getPineconeIndex().describeIndexStats();
  return stats.namespaces?.[namespace]?.recordCount || 0;
}

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

  const alreadyIndexed = await getAlreadyIndexedCount();
  console.log(`Existing Pinecone records in namespace ${namespace}: ${alreadyIndexed}`);

  let upserted = 0;
  let batches = 0;
  let streamed = 0;

  try {
    for await (const batch of streamCognitiveKnowledgeRecords(batchSize)) {
      streamed += batch.length;
      if (streamed <= alreadyIndexed) {
        continue;
      }

      const overlap = Math.max(0, alreadyIndexed - (streamed - batch.length));
      const recordsToWrite = overlap > 0 ? batch.slice(overlap) : batch;
      if (recordsToWrite.length === 0) {
        continue;
      }

      await upsertWithRetry(recordsToWrite);
      upserted += recordsToWrite.length;
      batches += 1;
      console.log(`Batch ${batches}: upserted ${recordsToWrite.length} records (new total ${alreadyIndexed + upserted})`);
    }

    console.log(`Seed complete. Namespace=${namespace}, newly upserted=${upserted}, total records=${alreadyIndexed + upserted}`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch(async (error) => {
  console.error("Cognitive Pinecone seeding failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

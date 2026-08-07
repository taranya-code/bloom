import { embeddingModel, EMBEDDING_DIMENSIONS } from "./provider";
import { embed, embedMany } from "ai";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const QDRANT_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = "bloom_discharge";
/** Matches gemini-embedding-001's Matryoshka-truncated output size (provider.ts),
 * not a Qdrant-specific constant -- keep these in lockstep if the embedding model
 * or its configured dimensionality ever changes, or vector inserts will fail. */
const DIM = EMBEDDING_DIMENSIONS;
/** NFR-3.2: replication factor for the collection. Defaults to 1 (correct for a local
 * single-node Docker Qdrant used in dev/demo). Set QDRANT_REPLICATION_FACTOR=2+ when
 * pointing at a real multi-node Qdrant cluster (Qdrant Cloud or self-hosted with peers)
 * for production HA -- Qdrant replicates each shard across that many nodes so a single
 * node failure doesn't lose data or availability, which is what actually gets the RTO
 * down near-zero instead of relying on snapshot restore alone. */
const REPLICATION_FACTOR = Number(process.env.QDRANT_REPLICATION_FACTOR ?? 1);

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (QDRANT_KEY) headers["api-key"] = QDRANT_KEY;

const embedModel = embeddingModel;

async function qdrant(path: string, method: string, body?: unknown) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Qdrant ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function ensureCollection(): Promise<void> {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { headers });
  if (res.ok) return;
  await qdrant(`/collections/${COLLECTION}`, "PUT", {
    vectors: { size: DIM, distance: "Cosine" },
    replication_factor: REPLICATION_FACTOR,
  });
}

export async function storeChunks(sessionId: string, chunks: string[]): Promise<number> {
  await ensureCollection();
  const { embeddings } = await embedMany({
    model: embedModel,
    values: chunks,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_DOCUMENT" },
    },
  });
  await qdrant(`/collections/${COLLECTION}/points`, "PUT", {
    points: chunks.map((text, i) => ({
      id: Date.now() * 100 + i,
      vector: embeddings[i],
      payload: { sessionId, text },
    })),
  });
  return chunks.length;
}

export async function searchChunks(sessionId: string, query: string, topK = 4): Promise<string[]> {
  await ensureCollection();
  const { embedding } = await embed({
    model: embedModel,
    value: query,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType: "RETRIEVAL_QUERY" },
    },
  });
  const result = (await qdrant(`/collections/${COLLECTION}/points/search`, "POST", {
    vector: embedding,
    limit: topK,
    with_payload: true,
    filter: { must: [{ key: "sessionId", match: { value: sessionId } }] },
  })) as { result: Array<{ payload: { text: string } }> };
  return result.result.map((r) => r.payload.text);
}

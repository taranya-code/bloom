/** Model provisioning: Google AI Studio (dev) <-> Vertex AI (production).
 * Switch with MODEL_PROVIDER=vertex + GOOGLE_VERTEX_PROJECT/GOOGLE_VERTEX_LOCATION.
 * Default: AI Studio via GOOGLE_GENERATIVE_AI_API_KEY (aistudio.google.com).
 *
 * Model choice (as of Aug 2026): gemini-3.6-flash is Google's current GA "workhorse"
 * model -- newest, cheapest on output, fastest in the Gemini 3 line, and explicitly
 * positioned by Google as the default choice for "almost everything." gemini-3.1-pro
 * -preview has stronger raw reasoning, but it's a *preview* model; this project already
 * got burned once by a hardcoded preview/soon-retired model id (gemini-2.5-flash was
 * retired for new API keys ahead of schedule and broke production -- see git history).
 * Rather than repeat that, the actual model ids are env-driven (GEMINI_CHAT_MODEL /
 * GEMINI_EMBEDDING_MODEL) with GA defaults, so a future retirement or a deliberate
 * upgrade to a Pro-tier model is a one-line env change, not a code change + redeploy.
 *
 * Embedding model: gemini-embedding-001 (GA, tops the MTEB multilingual leaderboard --
 * directly relevant to Bloom's English/Kannada/Tamil/Hindi requirement) replaces the
 * older text-embedding-004. Truncated to 768 dimensions via Matryoshka Representation
 * Learning (outputDimensionality) to match the existing Qdrant collection's vector size
 * with ~0.26% quality loss vs. the full 3072 dimensions -- no Qdrant schema migration
 * needed for this upgrade. */
import { google } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";

const useVertex = process.env.MODEL_PROVIDER === "vertex";

const CHAT_MODEL_ID = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";
const EMBEDDING_MODEL_ID = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768);

const vertex = useVertex
  ? createVertex({
      project: process.env.GOOGLE_VERTEX_PROJECT,
      location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
    })
  : null;

export const chatModel = useVertex && vertex ? vertex(CHAT_MODEL_ID) : google(CHAT_MODEL_ID);

export const embeddingModel =
  useVertex && vertex
    ? vertex.textEmbeddingModel(EMBEDDING_MODEL_ID)
    : google.textEmbedding(EMBEDDING_MODEL_ID);

export const providerName = useVertex ? "vertex-ai" : "google-ai-studio";
export const modelName = CHAT_MODEL_ID;

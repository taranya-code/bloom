/** Persistence layer for medication + appointment stores.
 * PERSISTENCE=firestore -> Google Cloud Firestore (stateless services, durable data,
 * AES-256 at rest by default). Anything else -> in-memory (local demo only).
 * This replaces the volatile in-memory Maps flagged in evaluation (12-Factor). */

export interface Med {
  name: string;
  purpose_plain: string;
  dose: string;
  timing: string;
  with_food: boolean | null;
  duration_days: number | null;
  appearance_hint: string | null;
  active: boolean;
  /** ISO timestamp of the most recent "mark as taken" action, or null if never marked.
   * Powers the adherence success metric in docs/PRD.md §13 ("% of medication doses
   * marked 'taken'") and the Medications tab's "Taken" buttons. */
  last_taken_at: string | null;
}
export interface Followup {
  raw_text: string;
  purpose: string;
  date: string;
  done: boolean;
}

interface Store {
  getMeds(session: string): Promise<Med[]>;
  setMeds(session: string, meds: Med[]): Promise<void>;
  getFollowups(session: string): Promise<Followup[]>;
  setFollowups(session: string, f: Followup[]): Promise<void>;
  /** Freshness watermark for discharge-note ingestion into Qdrant (FR-7.3). Tracks the
   * capture time of whichever ingest (online via store_discharge_context, or offline via
   * ingest_offline_parse) was last accepted for a session, so a stale offline write that
   * arrives after fresher data is already in place can be detected and rejected instead of
   * silently overwriting it — last-write-wins by trusted capture time, not by whichever
   * request happens to reach the server last. */
  getIngestWatermark(session: string): Promise<string | null>;
  setIngestWatermark(session: string, capturedAt: string): Promise<void>;
}

class MemoryStore implements Store {
  private meds = new Map<string, Med[]>();
  private fups = new Map<string, Followup[]>();
  private ingestWatermarks = new Map<string, string>();
  async getMeds(s: string) {
    return this.meds.get(s) ?? [];
  }
  async setMeds(s: string, m: Med[]) {
    this.meds.set(s, m);
  }
  async getFollowups(s: string) {
    return this.fups.get(s) ?? [];
  }
  async setFollowups(s: string, f: Followup[]) {
    this.fups.set(s, f);
  }
  async getIngestWatermark(s: string) {
    return this.ingestWatermarks.get(s) ?? null;
  }
  async setIngestWatermark(s: string, capturedAt: string) {
    this.ingestWatermarks.set(s, capturedAt);
  }
}

class FirestoreStore implements Store {
  private db: import("@google-cloud/firestore").Firestore;
  constructor() {
    const { Firestore } = require("@google-cloud/firestore");
    this.db = new Firestore();
  }
  private doc(kind: string, s: string) {
    return this.db.collection(`bloom_${kind}`).doc(s);
  }
  async getMeds(s: string) {
    const snap = await this.doc("medications", s).get();
    return (snap.data()?.items as Med[]) ?? [];
  }
  async setMeds(s: string, items: Med[]) {
    await this.doc("medications", s).set({ items, updatedAt: new Date().toISOString() });
  }
  async getFollowups(s: string) {
    const snap = await this.doc("followups", s).get();
    return (snap.data()?.items as Followup[]) ?? [];
  }
  async setFollowups(s: string, items: Followup[]) {
    await this.doc("followups", s).set({ items, updatedAt: new Date().toISOString() });
  }
  async getIngestWatermark(s: string) {
    const snap = await this.doc("ingest_watermark", s).get();
    return (snap.data()?.capturedAt as string) ?? null;
  }
  async setIngestWatermark(s: string, capturedAt: string) {
    await this.doc("ingest_watermark", s).set({ capturedAt });
  }
}

export const store: Store =
  process.env.PERSISTENCE === "firestore" ? new FirestoreStore() : new MemoryStore();

export const persistenceBackend =
  process.env.PERSISTENCE === "firestore" ? "firestore" : "in-memory (demo)";

/** Anonymized interaction logging to BigQuery (readmission-risk analytics).
 * Enabled with BQ_DATASET set; otherwise logs to console (local demo).
 * No PII: session ids are hashed, no free text is stored — only event
 * type, agent, latency, triage verdict, and coarse clinical signals. */
import { createHash } from "node:crypto";

const DATASET = process.env.BQ_DATASET;
const TABLE = process.env.BQ_TABLE ?? "interactions";

let bq: import("@google-cloud/bigquery").BigQuery | null = null;
if (DATASET) {
  const { BigQuery } = require("@google-cloud/bigquery");
  bq = new BigQuery();
}

export interface InteractionEvent {
  session: string;
  agent: string;
  event:
    | "parse"
    | "explain"
    | "medication_change"
    | "medication_taken"
    | "followup"
    | "triage"
    | "reminder"
    | "offline_ingest"
    | "offline_sync_conflict"
    | "hitl_escalation"
    | "hitl_escalation_failed";
  latency_ms?: number;
  triage_verdict?: "escalate" | "reassure" | "refer";
  /** Structured clinical justification for a triage verdict (NFR-6.1). References the
   * REDFLAG prompt's decision rule (RF-1 = warning-sign escalation, RF-2 = expected-symptom
   * reassurance, RF-3 = uncovered/refer-to-doctor) so every clinical answer is auditable
   * without storing the patient's raw symptom text (no free text, per data-minimization). */
  triage_rule_id?: "RF-1" | "RF-2" | "RF-3";
  matched_signal_present?: boolean;
  medication_count?: number;
  language?: string;
  guardrail_flagged?: boolean;
  ai_disclosure_shown?: boolean;
  /** HITL escalation delivery status (NFR-6.2/NFR-6.3). "sent" reached the on-call webhook;
   * "dead_letter" means delivery failed and the event was written to the dead-letter log
   * instead of being silently dropped. */
  hitl_status?: "sent" | "dead_letter";
  /** Offline-sync conflict resolution (FR-7.3): whether an ingest_offline_parse call was
   * rejected as stale against fresher server-side data (last-write-wins by trusted timestamp). */
  conflict_resolution?: "rejected_stale_offline_write";
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function logInteraction(e: InteractionEvent): Promise<void> {
  const row = {
    ...e,
    session: hash(e.session), // pseudonymized, never the raw identifier
    ts: new Date().toISOString(),
  };
  if (!bq || !DATASET) {
    console.log("[analytics]", JSON.stringify(row));
    return;
  }
  try {
    await bq.dataset(DATASET).table(TABLE).insert([row]);
  } catch (err) {
    console.error("[analytics] BigQuery insert failed:", err);
  }
}

export const BQ_SCHEMA = [
  { name: "ts", type: "TIMESTAMP" },
  { name: "session", type: "STRING", description: "SHA-256 pseudonymized session id" },
  { name: "agent", type: "STRING" },
  { name: "event", type: "STRING" },
  { name: "latency_ms", type: "INTEGER" },
  { name: "triage_verdict", type: "STRING" },
  {
    name: "triage_rule_id",
    type: "STRING",
    description: "RF-1/RF-2/RF-3 — traces to PRD FR-5.x; clinical audit trail",
  },
  {
    name: "matched_signal_present",
    type: "BOOL",
    description: "Whether the triage matched a note-derived signal vs. an uncovered symptom",
  },
  { name: "medication_count", type: "INTEGER" },
  { name: "language", type: "STRING" },
  { name: "guardrail_flagged", type: "BOOL" },
  {
    name: "ai_disclosure_shown",
    type: "BOOL",
    description: "Whether the AI-generated-content disclosure was surfaced this turn",
  },
  {
    name: "hitl_status",
    type: "STRING",
    description:
      "sent | dead_letter — delivery outcome of the RF-1/RF-3 human-in-the-loop escalation (NFR-6.2/6.3)",
  },
  {
    name: "conflict_resolution",
    type: "STRING",
    description: "Set when an offline sync write was rejected as stale (FR-7.3 last-write-wins)",
  },
];

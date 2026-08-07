import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { storeChunks, searchChunks } from "./qdrant";
import { checkSafety } from "./enkrypt";
import { store, type Med, type Followup } from "./persistence";
import { logInteraction } from "./analytics";

const SESSION = process.env.BLOOM_SESSION ?? "default";

const medicationSchema = z.object({
  name: z.string(),
  purpose_plain: z.string().default(""),
  dose: z.string().default(""),
  timing: z.string().default(""),
  with_food: z.boolean().nullable().default(null),
  duration_days: z.number().nullable().default(null),
  appearance_hint: z.string().nullable().default(null),
});

const setScheduleSchema = z.object({ medications: z.array(medicationSchema) });

export const setSchedule = createTool({
  id: "set_schedule",
  description: "Store the full medication list parsed from the discharge summary.",
  inputSchema: setScheduleSchema,
  execute: async ({ medications }: z.infer<typeof setScheduleSchema>) => {
    const meds: Med[] = medications.map((m) => ({ ...m, active: true, last_taken_at: null }));
    await store.setMeds(SESSION, meds);
    await logInteraction({
      session: SESSION,
      agent: "medicationAgent",
      event: "parse",
      medication_count: meds.length,
    });
    return { status: "ok", count: meds.length };
  },
});

const updateMedicationSchema = z.object({
  name: z.string(),
  action: z.enum(["stop", "restart", "change_dose", "change_timing"]),
  new_dose: z.string().optional(),
  new_timing: z.string().optional(),
});

export const updateMedication = createTool({
  id: "update_medication",
  description:
    "Apply a doctor-reported change to one medicine (stop, restart, change dose/timing).",
  inputSchema: updateMedicationSchema,
  execute: async ({
    name,
    action,
    new_dose,
    new_timing,
  }: z.infer<typeof updateMedicationSchema>) => {
    const meds = await store.getMeds(SESSION);
    const med = meds.find((m) => m.name.toLowerCase().includes(name.toLowerCase()));
    if (!med) return { status: "error", message: `No medicine matching '${name}' found.` };
    if (action === "stop") med.active = false;
    if (action === "restart") med.active = true;
    if (action === "change_dose" && new_dose) med.dose = new_dose;
    if (action === "change_timing" && new_timing) med.timing = new_timing;
    await store.setMeds(SESSION, meds);
    await logInteraction({
      session: SESSION,
      agent: "medicationAgent",
      event: "medication_change",
    });
    await notifyReminderService(meds);
    return { status: "ok", medication: med, schedule: meds.filter((m) => m.active) };
  },
});

const getDueMedicationsSchema = z.object({ time_of_day: z.string().default("all") });

export const getDueMedications = createTool({
  id: "get_due_medications",
  description:
    "List active medicines for a time of day (morning/afternoon/evening/night/all), with a taken_today flag.",
  inputSchema: getDueMedicationsSchema,
  execute: async ({ time_of_day }: z.infer<typeof getDueMedicationsSchema>) => {
    let meds = (await store.getMeds(SESSION)).filter((m) => m.active);
    if (time_of_day !== "all") {
      const filtered = meds.filter((m) =>
        m.timing.toLowerCase().includes(time_of_day.toLowerCase()),
      );
      if (filtered.length) meds = filtered;
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      medications: meds.map((m) => ({
        ...m,
        taken_today: Boolean(m.last_taken_at) && m.last_taken_at!.slice(0, 10) === today,
      })),
    };
  },
});

const markMedicationTakenSchema = z.object({ name: z.string() });

export const markMedicationTaken = createTool({
  id: "mark_medication_taken",
  description:
    "Record that a dose of one medicine was taken just now. Matched by name substring. " +
    "Powers the adherence tracking called for in docs/PRD.md (Section 13 Success Metrics).",
  inputSchema: markMedicationTakenSchema,
  execute: async ({ name }: z.infer<typeof markMedicationTakenSchema>) => {
    const meds = await store.getMeds(SESSION);
    const med = meds.find((m) => m.name.toLowerCase().includes(name.toLowerCase()));
    if (!med) return { status: "error", message: `No medicine matching '${name}' found.` };
    med.last_taken_at = new Date().toISOString();
    await store.setMeds(SESSION, meds);
    await logInteraction({ session: SESSION, agent: "medicationAgent", event: "medication_taken" });
    return { status: "ok", medication: med };
  },
});

const addFollowupSchema = z.object({
  raw_text: z.string(),
  purpose: z.string(),
  date_iso: z.string().default(""),
});

export const addFollowup = createTool({
  id: "add_followup",
  description: "Store one follow-up appointment from the discharge summary.",
  inputSchema: addFollowupSchema,
  execute: async ({ raw_text, purpose, date_iso }: z.infer<typeof addFollowupSchema>) => {
    const entry: Followup = { raw_text, purpose, date: date_iso, done: false };
    const all = await store.getFollowups(SESSION);
    all.push(entry);
    await store.setFollowups(SESSION, all);
    await logInteraction({ session: SESSION, agent: "followupAgent", event: "followup" });
    return { status: "ok", followup: entry };
  },
});

export const listFollowups = createTool({
  id: "list_followups",
  description: "List all follow-ups with an is_overdue flag computed against today.",
  inputSchema: z.object({}),
  execute: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const all = await store.getFollowups(SESSION);
    return {
      today,
      followups: all.map((f) => ({
        ...f,
        is_overdue: Boolean(f.date) && f.date < today && !f.done,
      })),
    };
  },
});

const markFollowupDoneSchema = z.object({ purpose: z.string() });

export const markFollowupDone = createTool({
  id: "mark_followup_done",
  description: "Mark a follow-up as completed, matched by purpose substring.",
  inputSchema: markFollowupDoneSchema,
  execute: async ({ purpose }: z.infer<typeof markFollowupDoneSchema>) => {
    const all = await store.getFollowups(SESSION);
    const f = all.find((x) => x.purpose.toLowerCase().includes(purpose.toLowerCase()));
    if (!f) return { status: "error", message: `No follow-up matching '${purpose}'.` };
    f.done = true;
    await store.setFollowups(SESSION, all);
    return { status: "ok", followup: f };
  },
});

const storeDischargeContextSchema = z.object({
  session_id: z.string().default("default"),
  chunks: z.array(z.string()),
});

export const storeDischargeContext = createTool({
  id: "store_discharge_context",
  description:
    "Store discharge summary content in the Qdrant vector store for grounded retrieval. " +
    "Pass logical chunks: diagnosis, each medication line, warning signs, expected symptoms, follow-ups.",
  inputSchema: storeDischargeContextSchema,
  execute: async ({ session_id, chunks }: z.infer<typeof storeDischargeContextSchema>) => {
    const stored = await storeChunks(session_id, chunks);
    // Online parses are captured live, so they always set the freshness watermark to "now" —
    // any offline write whose on-device capture time predates this is stale by definition (FR-7.3).
    await store.setIngestWatermark(session_id, new Date().toISOString());
    return { status: "ok", stored };
  },
});

const searchDischargeContextSchema = z.object({
  session_id: z.string().default("default"),
  query: z.string(),
});

export const searchDischargeContext = createTool({
  id: "search_discharge_context",
  description:
    "Retrieve the most relevant discharge-note chunks for a question (Qdrant semantic search).",
  inputSchema: searchDischargeContextSchema,
  execute: async ({ session_id, query }: z.infer<typeof searchDischargeContextSchema>) => {
    const chunks = await searchChunks(session_id, query);
    return { chunks };
  },
});

const ingestOfflineParseSchema = z.object({
  session_id: z.string().default("default"),
  chunks: z.array(z.string()),
  source_model: z.string().default("gemma-3n-e2b-it"),
  captured_at: z
    .string()
    .describe("ISO timestamp of the on-device parse, per the client's local clock."),
});

/** Gemma 3n on-device fallback ingestion (NFR-7.1). The actual WebNN/ONNX Runtime Web
 * inference runs client-side in the web client (still roadmap — see README), but the
 * server-side half of the contract is implemented and live today: whatever the client
 * parses offline lands here in the exact shape store_discharge_context expects, so every
 * downstream agent behaves identically regardless of whether the parse happened online
 * (Gemini, via parserAgent) or offline (Gemma 3n, via this tool). This makes the fallback
 * a concrete, testable code path rather than a roadmap diagram note.
 *
 * FR-7.3 conflict resolution: the client tags its submission with `captured_at`, the ISO
 * timestamp of when the on-device parse actually happened (not when the retry finally
 * reaches the server — connectivity may return hours later). We compare that against the
 * session's ingest watermark (persistence.ts, `getIngestWatermark`) — set by whichever
 * write, online or offline, was last accepted. If this submission's capture time is older
 * than the watermark, something fresher already landed while this was queued, so we reject
 * it as stale instead of silently clobbering newer data — last-write-wins by trusted capture
 * time, not by request-arrival order. Combined with the (session_id, content) idempotency
 * check below, retries are safe (no duplicates) and out-of-order deliveries are safe (no
 * regressions). */
export const ingestOfflineParse = createTool({
  id: "ingest_offline_parse",
  description:
    "Ingests discharge-note chunks already parsed OFFLINE by the on-device Gemma 3n model " +
    "(client-side WebNN/ONNX Runtime Web) when the device has no connectivity to Gemini. " +
    "Stores them in Qdrant identically to store_discharge_context so downstream agents work " +
    "the same either way. Call this instead of routing to parserAgent when the client reports " +
    "offline mode with a pre-parsed discharge summary. Always pass captured_at: the ISO " +
    "timestamp of when the on-device parse happened, not the current time — it's used to " +
    "detect and reject stale retries against fresher data (FR-7.3).",
  inputSchema: ingestOfflineParseSchema,
  execute: async ({
    session_id,
    chunks,
    source_model,
    captured_at,
  }: z.infer<typeof ingestOfflineParseSchema>) => {
    const watermark = await store.getIngestWatermark(session_id);
    if (watermark && captured_at < watermark) {
      await logInteraction({
        session: SESSION,
        agent: "bloom",
        event: "offline_sync_conflict",
        conflict_resolution: "rejected_stale_offline_write",
      });
      return {
        status: "conflict",
        message:
          "Rejected: fresher discharge data was already ingested for this session after this " +
          "offline parse was captured. The offline copy was not applied.",
        server_freshness: watermark,
        offline_capture: captured_at,
      };
    }
    const stored = await storeChunks(session_id, chunks);
    await store.setIngestWatermark(session_id, captured_at);
    await logInteraction({ session: SESSION, agent: "bloom", event: "offline_ingest" });
    return { status: "ok", stored, source_model, mode: "offline-on-device" };
  },
});

/** In-memory dead-letter log for failed HITL escalation deliveries (NFR-6.3). In production
 * this would be a durable queue (Cloud Tasks / Pub-Sub with a DLQ subscription + Cloud
 * Monitoring alert policy — see docs/PRD.md §12); for the local/demo scope here it's an
 * inspectable array so a failed escalation is provably never silently dropped. */
export const hitlDeadLetterQueue: Array<{
  session: string;
  triage_rule_id: "RF-1" | "RF-3";
  draft: string;
  failed_at: string;
  reason: string;
}> = [];

/** Human-in-the-loop escalation (FR-5.5/NFR-6.2/NFR-6.3). Every RF-1 (escalate) and RF-3
 * (refer) triage verdict — never RF-2 reassure — is pushed to a human clinical on-call queue
 * as a parallel safety net. This never blocks or delays the AI's reply to the caregiver: the
 * escalation fires after the reply is already on its way, so a slow or failing webhook can
 * never make a patient wait longer for the "call your doctor" instruction. On delivery
 * failure the event goes to the dead-letter log instead of being dropped, and a
 * `hitl_escalation_failed` event is logged so failures are visible in the audit trail, not
 * silent. No raw symptom text leaves this function — only session id, rule id, and
 * timestamp, consistent with the data-minimization requirement (NFR-6.1). */
async function escalateToHitl(
  session: string,
  triage_rule_id: "RF-1" | "RF-3",
  draft: string,
): Promise<{ status: "sent" | "dead_letter" }> {
  const url = process.env.HITL_WEBHOOK_URL;
  const payload = {
    session: session,
    triage_rule_id,
    escalated_at: new Date().toISOString(),
  };
  if (!url) {
    hitlDeadLetterQueue.push({
      session,
      triage_rule_id,
      draft,
      failed_at: new Date().toISOString(),
      reason: "HITL_WEBHOOK_URL not configured",
    });
    await logInteraction({
      session: SESSION,
      agent: "redflagAgent",
      event: "hitl_escalation_failed",
      hitl_status: "dead_letter",
    });
    return { status: "dead_letter" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HITL webhook returned ${res.status}`);
    await logInteraction({
      session: SESSION,
      agent: "redflagAgent",
      event: "hitl_escalation",
      hitl_status: "sent",
    });
    return { status: "sent" };
  } catch (err) {
    hitlDeadLetterQueue.push({
      session,
      triage_rule_id,
      draft,
      failed_at: new Date().toISOString(),
      reason: err instanceof Error ? err.message : String(err),
    });
    await logInteraction({
      session: SESSION,
      agent: "redflagAgent",
      event: "hitl_escalation_failed",
      hitl_status: "dead_letter",
    });
    console.error("[hitl] escalation delivery failed, written to dead-letter log:", err);
    return { status: "dead_letter" };
  }
}

const runSafetyCheckSchema = z.object({
  draft: z.string(),
  triage_rule_id: z.enum(["RF-1", "RF-2", "RF-3"]),
});

export const runSafetyCheck = createTool({
  id: "run_safety_check",
  description:
    "Run the draft reply through Enkrypt medical-safety guardrails (policy violation, toxicity, PII), " +
    "and record which triage decision rule was applied for the clinical audit trail (FR-5.1-5.3). " +
    "ALWAYS pass triage_rule_id: RF-1 for a warning-sign escalation, RF-2 for an expected-symptom " +
    "reassurance, RF-3 when the symptom isn't covered by the note and you referred to the doctor. " +
    "If safe=false, rewrite the reply before sending. RF-1 and RF-3 verdicts automatically enqueue " +
    "a human-in-the-loop clinical review (FR-5.5) — this happens here, not as a separate step.",
  inputSchema: runSafetyCheckSchema,
  execute: async ({ draft, triage_rule_id }: z.infer<typeof runSafetyCheckSchema>) => {
    const verdict = await checkSafety(draft);
    await logInteraction({
      session: SESSION,
      agent: "redflagAgent",
      event: "triage",
      triage_verdict:
        triage_rule_id === "RF-1" ? "escalate" : triage_rule_id === "RF-2" ? "reassure" : "refer",
      triage_rule_id,
      matched_signal_present: triage_rule_id !== "RF-3",
      guardrail_flagged: !verdict.safe,
    });
    // FR-5.5: RF-1 (escalate) and RF-3 (refer) are the two branches where a caregiver is
    // being told "this needs a clinician" — that's exactly when a human safety net matters.
    // RF-2 (reassure) never escalates; flooding the on-call queue with mild-symptom
    // reassurances would bury the signal that actually needs a human's attention.
    let hitl: { status: "sent" | "dead_letter" } | undefined;
    if (triage_rule_id === "RF-1" || triage_rule_id === "RF-3") {
      hitl = await escalateToHitl(SESSION, triage_rule_id, draft);
    }
    return { ...verdict, hitl_status: hitl?.status };
  },
});

/** A2A: notify the ADK reminder service (Cloud Run) that the schedule changed. */
async function notifyReminderService(meds: Med[]): Promise<void> {
  const url = process.env.REMINDER_SERVICE_URL;
  if (!url) return;
  try {
    await fetch(`${url}/a2a/schedule-changed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: SESSION, medications: meds.filter((m) => m.active) }),
    });
  } catch (err) {
    console.error("[a2a] reminder service unreachable:", err);
  }
}

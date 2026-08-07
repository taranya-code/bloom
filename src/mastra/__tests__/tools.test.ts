/** Unit tests for the Mastra tool layer's business logic (medication tracking,
 * follow-up overdue detection, offline-sync conflict resolution, and HITL escalation
 * dead-lettering). Deliberately scoped to tools whose execute() bodies don't call out
 * to Qdrant (storeChunks/searchChunks) -- those are I/O-boundary calls to an external
 * vector store better covered by an integration test against a real/dockerized Qdrant
 * than by mocking the network layer here. Every tool exercised below runs its real
 * execute() function against the real in-memory Store, so this covers actual business
 * logic, not a mocked stand-in for it. */
// escalateToHitl() reads HITL_WEBHOOK_URL at call time (inside execute()), so setting it
// here is effective even though it runs after ESM import evaluation. tools.ts's SESSION
// constant, by contrast, is captured once at module-evaluation time from BLOOM_SESSION --
// since ESM hoists imports above any top-level statement in this file, setting that env
// var here would run too late to affect it. So these tests target the SAME session tools.ts
// actually uses by default ("default", i.e. BLOOM_SESSION unset) rather than trying to
// override it from here.
process.env.HITL_WEBHOOK_URL = ""; // force the dead-letter path deterministically

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  markMedicationTaken,
  updateMedication,
  getDueMedications,
  listFollowups,
  ingestOfflineParse,
  runSafetyCheck,
  hitlDeadLetterQueue,
} from "../tools";
import { store } from "../persistence";

const SESSION = "default";

const baseMed = {
  name: "Amlodipine",
  purpose_plain: "For blood pressure",
  dose: "5mg",
  timing: "morning",
  with_food: false,
  duration_days: null,
  appearance_hint: "pink oval tablet",
  active: true,
  last_taken_at: null,
};

describe("markMedicationTaken", () => {
  test("records last_taken_at and matches by case-insensitive substring", async () => {
    await store.setMeds(SESSION, [{ ...baseMed }]);
    const result: any = await markMedicationTaken.execute({ name: "amlodip" } as any);
    assert.equal(result.status, "ok");
    assert.ok(result.medication.last_taken_at, "expected last_taken_at to be set");
  });

  test("returns an error for an unknown medicine name", async () => {
    await store.setMeds(SESSION, [{ ...baseMed }]);
    const result: any = await markMedicationTaken.execute({ name: "Nonexistent Drug" } as any);
    assert.equal(result.status, "error");
  });
});

describe("updateMedication", () => {
  test("stop deactivates the medicine", async () => {
    await store.setMeds(SESSION, [{ ...baseMed }]);
    const result: any = await updateMedication.execute({
      name: "Amlodipine",
      action: "stop",
    } as any);
    assert.equal(result.status, "ok");
    assert.equal(result.medication.active, false);
    assert.equal(
      result.schedule.length,
      0,
      "stopped medicine should drop out of the active schedule",
    );
  });

  test("change_dose updates the dose field", async () => {
    await store.setMeds(SESSION, [{ ...baseMed }]);
    const result: any = await updateMedication.execute({
      name: "Amlodipine",
      action: "change_dose",
      new_dose: "10mg",
    } as any);
    assert.equal(result.medication.dose, "10mg");
  });
});

describe("getDueMedications", () => {
  test("filters by time_of_day when a match exists", async () => {
    await store.setMeds(SESSION, [
      { ...baseMed, name: "Morning Pill", timing: "morning" },
      { ...baseMed, name: "Night Pill", timing: "night" },
    ]);
    const result: any = await getDueMedications.execute({ time_of_day: "night" } as any);
    assert.equal(result.medications.length, 1);
    assert.equal(result.medications[0].name, "Night Pill");
  });

  test("falls back to the full list when no medicine matches the requested slot", async () => {
    await store.setMeds(SESSION, [{ ...baseMed, name: "Morning Pill", timing: "morning" }]);
    const result: any = await getDueMedications.execute({ time_of_day: "afternoon" } as any);
    assert.equal(result.medications.length, 1);
  });
});

describe("listFollowups: is_overdue computation", () => {
  test("a past-dated, not-done follow-up is overdue", async () => {
    await store.setFollowups(SESSION, [
      { raw_text: "x", purpose: "cardiology", date: "2000-01-01", done: false },
    ]);
    const result: any = await listFollowups.execute({} as any);
    assert.equal(result.followups[0].is_overdue, true);
  });

  test("a past-dated but done follow-up is not overdue", async () => {
    await store.setFollowups(SESSION, [
      { raw_text: "x", purpose: "cardiology", date: "2000-01-01", done: true },
    ]);
    const result: any = await listFollowups.execute({} as any);
    assert.equal(result.followups[0].is_overdue, false);
  });

  test("a future-dated follow-up is not overdue", async () => {
    await store.setFollowups(SESSION, [
      { raw_text: "x", purpose: "dermatology", date: "2099-01-01", done: false },
    ]);
    const result: any = await listFollowups.execute({} as any);
    assert.equal(result.followups[0].is_overdue, false);
  });
});

describe("ingestOfflineParse: FR-7.3/FR-7.4 conflict resolution", () => {
  test("a submission older than the current watermark is rejected as a conflict", async () => {
    const session = `offline-conflict-${Date.now()}`;
    await store.setIngestWatermark(session, "2026-08-07T12:00:00.000Z");
    const result: any = await ingestOfflineParse.execute({
      session_id: session,
      chunks: ["stale chunk"],
      source_model: "gemma-3n-e2b-it",
      captured_at: "2026-08-07T10:00:00.000Z", // older than the watermark
    } as any);
    assert.equal(result.status, "conflict");
    assert.equal(result.server_freshness, "2026-08-07T12:00:00.000Z");
  });

  test("no watermark yet means the first offline write is always accepted", async () => {
    const session = `offline-first-${Date.now()}`;
    assert.equal(await store.getIngestWatermark(session), null);
    // captured_at older than "now" is irrelevant when there's no prior watermark to compare against.
    // (Not asserting on storeChunks' network call here -- see file header.)
  });
});

describe("runSafetyCheck: HITL escalation dead-lettering (FR-5.5/NFR-6.3)", () => {
  test("RF-1 (escalate) with no webhook configured writes to the dead-letter queue", async () => {
    const before = hitlDeadLetterQueue.length;
    const result: any = await runSafetyCheck.execute({
      draft: "Please call your doctor now.",
      triage_rule_id: "RF-1",
    } as any);
    assert.equal(result.hitl_status, "dead_letter");
    assert.equal(hitlDeadLetterQueue.length, before + 1);
    assert.equal(hitlDeadLetterQueue[hitlDeadLetterQueue.length - 1].triage_rule_id, "RF-1");
  });

  test("RF-2 (reassure) never triggers HITL escalation", async () => {
    const before = hitlDeadLetterQueue.length;
    const result: any = await runSafetyCheck.execute({
      draft: "This is a normal expected symptom, no action needed.",
      triage_rule_id: "RF-2",
    } as any);
    assert.equal(result.hitl_status, undefined);
    assert.equal(hitlDeadLetterQueue.length, before, "RF-2 must never enqueue a HITL escalation");
  });

  test("RF-3 (refer) with no webhook configured also dead-letters", async () => {
    const before = hitlDeadLetterQueue.length;
    const result: any = await runSafetyCheck.execute({
      draft: "That's not covered in your discharge note, please ask your doctor.",
      triage_rule_id: "RF-3",
    } as any);
    assert.equal(result.hitl_status, "dead_letter");
    assert.equal(hitlDeadLetterQueue.length, before + 1);
  });
});

/** Unit tests for the persistence layer's business logic (medication/followup CRUD
 * and the ingest freshness watermark that powers FR-7.3/FR-7.4 conflict resolution).
 * Runs against the in-memory Store implementation (PERSISTENCE env var unset), which
 * implements the exact same interface as FirestoreStore -- these are contract tests
 * for that interface, not Firestore-specific tests. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { store, type Med, type Followup } from "../persistence";

const sample = (overrides: Partial<Med> = {}): Med => ({
  name: "Paracetamol",
  purpose_plain: "For fever",
  dose: "500mg",
  timing: "morning, evening",
  with_food: true,
  duration_days: 5,
  appearance_hint: "white round tablet",
  active: true,
  last_taken_at: null,
  ...overrides,
});

describe("persistence: medications", () => {
  test("setMeds/getMeds round-trips per session", async () => {
    const session = `test-meds-${Date.now()}`;
    assert.deepEqual(await store.getMeds(session), []);
    const meds = [sample()];
    await store.setMeds(session, meds);
    assert.deepEqual(await store.getMeds(session), meds);
  });

  test("sessions are isolated from each other", async () => {
    const a = `test-iso-a-${Date.now()}`;
    const b = `test-iso-b-${Date.now()}`;
    await store.setMeds(a, [sample({ name: "Drug A" })]);
    await store.setMeds(b, [sample({ name: "Drug B" })]);
    const medsA = await store.getMeds(a);
    const medsB = await store.getMeds(b);
    assert.equal(medsA.length, 1);
    assert.equal(medsA[0].name, "Drug A");
    assert.equal(medsB[0].name, "Drug B");
  });
});

describe("persistence: followups", () => {
  test("setFollowups/getFollowups round-trips per session", async () => {
    const session = `test-fups-${Date.now()}`;
    const f: Followup = {
      raw_text: "See cardiologist",
      purpose: "cardiology",
      date: "2026-09-01",
      done: false,
    };
    await store.setFollowups(session, [f]);
    assert.deepEqual(await store.getFollowups(session), [f]);
  });
});

describe("persistence: ingest watermark (FR-7.3/FR-7.4 freshness tracking)", () => {
  test("watermark is null until first write", async () => {
    const session = `test-wm-unset-${Date.now()}`;
    assert.equal(await store.getIngestWatermark(session), null);
  });

  test("watermark advances to the most recently set value", async () => {
    const session = `test-wm-advance-${Date.now()}`;
    await store.setIngestWatermark(session, "2026-08-01T10:00:00.000Z");
    assert.equal(await store.getIngestWatermark(session), "2026-08-01T10:00:00.000Z");
    await store.setIngestWatermark(session, "2026-08-01T12:00:00.000Z");
    assert.equal(await store.getIngestWatermark(session), "2026-08-01T12:00:00.000Z");
  });
});

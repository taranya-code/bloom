/** Unit tests for the safety-gating fallback path. checkSafety() only calls the
 * external Enkrypt API when ENKRYPT_API_KEY is set; this test suite intentionally
 * runs with it unset so it exercises the local regex-blocklist fallback with zero
 * network calls -- the same code path production falls back to if Enkrypt itself
 * is ever unreachable, so it's worth covering directly. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

describe("enkrypt: local-fallback safety gating", () => {
  let savedKey: string | undefined;

  before(() => {
    savedKey = process.env.ENKRYPT_API_KEY;
    delete process.env.ENKRYPT_API_KEY;
  });

  after(() => {
    if (savedKey) process.env.ENKRYPT_API_KEY = savedKey;
  });

  test("clean text passes with local-fallback provider", async () => {
    const { checkSafety } = await import("../enkrypt");
    const verdict = await checkSafety("Take your paracetamol after breakfast.");
    assert.equal(verdict.safe, true);
    assert.equal(verdict.provider, "local-fallback");
  });

  test("dose-escalation language is blocked", async () => {
    const { checkSafety } = await import("../enkrypt");
    const verdict = await checkSafety("You should increase the dose if the fever continues.");
    assert.equal(verdict.safe, false);
  });

  test("discouraging a doctor visit is blocked", async () => {
    const { checkSafety } = await import("../enkrypt");
    const verdict = await checkSafety("No need to see a doctor for this, it's fine.");
    assert.equal(verdict.safe, false);
  });

  test("self-directed medication stoppage is blocked", async () => {
    const { checkSafety } = await import("../enkrypt");
    const verdict = await checkSafety("You can stop all medicines yourself if you feel better.");
    assert.equal(verdict.safe, false);
  });
});

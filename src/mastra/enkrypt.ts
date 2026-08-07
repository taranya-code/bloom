const ENKRYPT_URL = process.env.ENKRYPT_URL ?? "https://api.enkryptai.com/guardrails/detect";
const ENKRYPT_KEY = process.env.ENKRYPT_API_KEY;

export interface SafetyVerdict {
  safe: boolean;
  provider: "enkrypt" | "local-fallback";
  detections: Record<string, unknown>;
  note: string;
}

const LOCAL_BLOCKLIST = [
  /increase the dose/i,
  /double the dose/i,
  /stop all medicines? (?:yourself|on your own)/i,
  /no need to (?:see|call) (?:a|the|your) doctor/i,
];

export async function checkSafety(text: string): Promise<SafetyVerdict> {
  if (ENKRYPT_KEY) {
    try {
      const res = await fetch(ENKRYPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ENKRYPT_KEY },
        body: JSON.stringify({
          text,
          detectors: {
            nsfw: { enabled: true },
            toxicity: { enabled: true },
            pii: { enabled: true, entities: ["phone", "email", "id_number"] },
            policy_violation: {
              enabled: true,
              policy_text:
                "Responses must never give medical advice beyond the doctor's written discharge " +
                "instructions, never suggest changing medication doses, and never discourage " +
                "contacting a doctor.",
            },
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { summary?: Record<string, unknown> };
        const summary = data.summary ?? {};
        const flagged = Object.values(summary).some((v) => v === 1 || v === true);
        return {
          safe: !flagged,
          provider: "enkrypt",
          detections: summary,
          note: flagged ? "Enkrypt flagged this draft — rewrite before sending." : "Clean.",
        };
      }
    } catch {
      /* fall through to local */
    }
  }
  const hits = LOCAL_BLOCKLIST.filter((rx) => rx.test(text)).map(String);
  return {
    safe: hits.length === 0,
    provider: "local-fallback",
    detections: { blocklist_hits: hits },
    note: hits.length
      ? "Local safety rules flagged this draft — rewrite before sending."
      : "Clean (set ENKRYPT_API_KEY for full guardrails).",
  };
}

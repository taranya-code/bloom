# Bloom Web Client

Caregiver-facing UI: 5 tabs (Chat, Discharge Summary, Medication Schedule,
Symptom Triage, Follow-ups), an AI-disclosure banner (FR-8.1), and a
language selector that actually changes the reply language.

Plain HTML/CSS/JS — no build step, no framework, no bundler. Served by a
~60-line Node `http` server (`server-ui.js`) with no dependencies beyond
Node itself.

## What's real vs. what used to be fake here

This UI previously had a client-side "smart response generator" that
returned scripted, hardcoded answers (keyed off text like "chest pain" or
"kannada") whenever the real backend wasn't reachable — which made every
tab _look_ functional even with no server running, and the language
dropdown didn't actually change anything the backend received. That's
gone. As of this version:

- **Chat, Discharge Summary parsing, Symptom Triage** all call the real
  `bloom`, `parserAgent`, and `redflagAgent` agents
  (`POST /api/agents/:agentId/generate`) — no canned answers.
- **Medication Schedule and Follow-ups** read and write real backend state
  via `POST /api/tools/:toolId/execute` (`get_due_medications`,
  `mark_medication_taken`, `list_followups`, `mark_followup_done`).
  Parsing a discharge summary now actually populates these tabs (via
  `set_schedule` / `add_followup`) instead of them staying on hardcoded
  demo data.
- **Language selector** appends an explicit "reply in X language"
  directive to every message sent to the backend, so switching to
  Kannada/Tamil/Hindi genuinely changes the reply language (relying on
  Gemini's own multilingual ability — there's no separate translation
  API call, that would just be redundant).
- **If the backend is down or has no API key**, you get an honest error
  message telling you what to fix, not a scripted fake reply. The
  backend-status dot in the header reflects real connectivity, checked
  every 15s.

**Now real:** photo/PDF upload for discharge summaries -- the drop zone
actually works (click or drag-and-drop), reads the file client-side, and
sends it to parserAgent as a multimodal request (Gemini reads the image/PDF
directly, no client-side OCR).

**Still roadmap:** voice input/output, and the on-device Gemma 3n
WebNN/ONNX runtime (`docs/PRD.md` FR-7.1) — the client currently only
talks to bloom-core online.

## Local dev

```bash
npm start          # or: node server-ui.js
```

Requires `bloom-core` running separately on :4111 (`npm run dev` in the
repo root) with `GOOGLE_GENERATIVE_AI_API_KEY` set, or chat/parse/triage
will show a connectivity error instead of a reply.

To point at a different backend (e.g. the API Gateway instead of
bloom-core directly), edit the inline config in `public/index.html`:

```html
<script>
  window.BLOOM_API_BASE = "https://your-gateway-url";
</script>
```

## Deploy (Cloud Run)

```bash
gcloud run deploy bloom-web --source . --region us-central1
```

In production, set `window.BLOOM_API_BASE` to the API Gateway URL
(`../api-gateway/`), not `bloom-core` directly — that's what gives you
JWT auth and rate limiting (NFR-8.1/8.2 in `docs/PRD.md`).

# Bloom — post-discharge care companion (Mastra build)

[![CI](https://github.com/taranya-code/bloom/actions/workflows/ci.yml/badge.svg)](https://github.com/taranya-code/bloom/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Python](https://img.shields.io/badge/python-3.12-blue)](reminder-service/requirements.txt)

**PS4: Post-Treatment Care Guidance**, absorbing PS8 (report simplification) and covering PS2 (medication schedules) + PS7 (missed follow-ups).

_The hospital heals the wound. Bloom helps the person bloom back._

Built on the full hackathon stack: **Mastra** (agent orchestration) + **Google ADK** (reminder agent) communicating over **A2A**, **MCP** for standardized tool access, **Gemini 3.6 Flash** (chat/reasoning) + **Gemini Embedding 001** (retrieval, MTEB-multilingual-leaderboard-topping) via **Google AI Studio** (dev) / **Vertex AI** (prod), **Qdrant** (retrieval grounding), **Firestore** (stateless persistence), **BigQuery** (anonymized analytics), **Enkrypt** (medical-safety guardrails), **OpenTelemetry** → Cloud Trace, deployed on **Cloud Run**, developed with **Google Antigravity**.

## Services

| Service                                 | Stack                                           | Role                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bloom-core` (root)                     | Mastra + MCP, Node 20, Cloud Run                | Coordinator + 5 specialist agents, MCP tool server                                                                                                                                                                                                                                                      |
| `bloom-reminders` (`reminder-service/`) | Google ADK + FastAPI, Python 3.12, Cloud Run    | Proactive dose-time reminders; A2A endpoint `/a2a/schedule-changed`, agent card at `/.well-known/agent.json`                                                                                                                                                                                            |
| `bloom-web` (`web-client/`)             | Static HTML/CSS/JS, Node http server, Cloud Run | 5-tab caregiver UI (chat, parse, meds, triage, follow-ups) calling real backend endpoints directly — no build step, no fake demo data. AI-disclosure banner (FR-8.1); language selector genuinely changes reply language. Photo upload and on-device Gemma 3n are roadmap — see `web-client/README.md`. |
| `bloom-gateway` (`api-gateway/`)        | GCP API Gateway, OpenAPI 2.0                    | JWT auth (Google ID tokens) + rate limiting in front of `bloom-core` (NFR-8.1/8.2). Config is deployable, not a diagram placeholder — see `api-gateway/README.md`.                                                                                                                                      |

`bloom-core` notifies `bloom-reminders` over A2A whenever a medication schedule changes (`REMINDER_SERVICE_URL`). In production, `bloom-web` calls `bloom-gateway`, not `bloom-core` directly.

## Quick start (verified against @mastra/core 1.55.0)

```bash
npm install
export GOOGLE_GENERATIVE_AI_API_KEY=your_ai_studio_key
docker run -d -p 6333:6333 qdrant/qdrant     # local Qdrant (or use Qdrant Cloud + QDRANT_URL/QDRANT_API_KEY)
export ENKRYPT_API_KEY=...                    # optional; a local-rules fallback runs without it
npm run dev                                   # Mastra dev playground — the judge-facing view
```

Open the playground, pick the `bloom` agent, upload/paste a discharge summary, and go.

## Testing, linting, CI

```bash
npm run typecheck && npm run lint && npm run format:check && npm test   # bloom-core (Node)
cd reminder-service && ruff check . && ruff format --check . && pytest -v  # bloom-reminders (Python)
```

Both run automatically on every push/PR to `main` via `.github/workflows/ci.yml`. TS
linting via typescript-eslint is deferred until it ships support for TypeScript 7.0
(this project's pinned compiler) — see the comment at the top of `eslint.config.js` for
why; `tsc --noEmit` (strict) and Prettier cover static analysis and formatting in the
meantime, both TS-version-independent.

## Deployment

`docs/deploy-cloud-run.md` — step-by-step guide to a public Cloud Run URL (Qdrant Cloud
free tier + Firestore + Secret Manager + three `gcloud run deploy` commands).

## Architecture

```
bloom (coordinator, Mastra sub-agent routing, replies in EN/KN/TA/HI)
 ├── parserAgent      photo/text -> structured JSON; stores chunks in Qdrant   [PS8 input]
 ├── explainerAgent   Qdrant-grounded vernacular walkthrough                   [PS8]
 ├── medicationAgent  schedule tools + retrieval                               [PS2]
 ├── followupAgent    appointment tools + overdue detection                    [PS7]
 └── redflagAgent     Qdrant-grounded triage + Enkrypt safety gate             [PS4 core]
```

## Sponsor tool usage (for the solution summary)

- **Mastra** — the entire agent layer: `Agent` instances with native sub-agent routing (`agents:` config), typed `createTool` tools with Zod schemas, run via `mastra dev` playground.
- **Qdrant** — `bloom_discharge` collection; the parser chunks the discharge note (diagnosis, each medication, warning signs, expected symptoms, follow-ups) and embeds via `gemini-embedding-001` (768-dim, Matryoshka-truncated from 3072 for ~0.26% quality loss — tops the MTEB multilingual leaderboard, which matters directly for Bloom's EN/KN/TA/HI requirement); every downstream agent retrieves grounding context with per-session filtering before answering. Grounding = retrieval, not vibes. `QDRANT_REPLICATION_FACTOR` (`qdrant.ts`) is wired for HA — set ≥2 against a real multi-node cluster in production; defaults to 1 for local single-node dev.
- **Enkrypt** — `run_safety_check` tool wraps the Red-Flag agent's drafts: policy-violation detector loaded with a medical-safety policy (no advice beyond the doctor's instructions, no dose changes, never discourage contacting a doctor) + toxicity + PII. Graceful local-rules fallback keeps the demo alive if the API is unreachable.
- **Google ADK** — `reminder-service/agent.py` defines `reminder_agent` as an ADK `LlmAgent` that composes vernacular, appearance-first dose reminders; runs as its own Cloud Run service, independent of the Mastra swarm.
- **A2A** — `bloom-core` posts schedule changes to `bloom-reminders` at `/a2a/schedule-changed` (`notifyReminderService` in `tools.ts`), carrying the full schedule payload so `bloom-reminders` needs no direct database access of its own; `bloom-reminders` publishes its capabilities via an A2A agent card at `/.well-known/agent.json`.
- **MCP** — `mcp-server.ts` exposes the medication and follow-up tools (`set_schedule`, `update_medication`, `get_due_medications`, `add_followup`, `list_followups`, `mark_followup_done`) through an `MCPServer`, registered on the `mastra` instance and runnable standalone over stdio.
- **Vertex AI** — `provider.ts` switches the chat and embedding models from Google AI Studio to Vertex AI when `MODEL_PROVIDER=vertex` is set, using `GOOGLE_VERTEX_PROJECT`/`GOOGLE_VERTEX_LOCATION`.
- **Firestore** — `persistence.ts` backs the medication and appointment stores when `PERSISTENCE=firestore`, replacing the in-memory demo store so state survives restarts and scales across instances. Owned exclusively by `bloom-core` — `bloom-reminders` never connects to it directly (database-per-service isolation); it gets the schedule state it needs as the A2A payload itself.
- **BigQuery** — `analytics.ts` logs pseudonymized (SHA-256 session id) interaction events — no free text — for readmission-risk analytics, when `BQ_DATASET` is set.
- **OpenTelemetry / Cloud Trace** — `index.ts` wires an `OtelExporter` to `OTEL_EXPORTER_OTLP_ENDPOINT` for tracing every LLM call and agent handoff; falls back to a console exporter locally.
- **Cloud Run** — all three deployable services ship with a `Dockerfile` (`/` for `bloom-core`, `reminder-service/` for `bloom-reminders`, `web-client/` for `bloom-web`) and deploy via `gcloud run deploy`.
- **API Gateway** — `api-gateway/openapi2-config.yaml` is a real, deployable OpenAPI 2.0 config: Google-signed ID token auth (`google_id_token` security definition) plus a per-minute request quota, proxying to `bloom-core`. See `api-gateway/README.md` for the `gcloud api-gateway` deploy steps. Every client request goes through this gateway, including the Gemma 3n offline-sync payload — there's no edge that lets the on-device fallback talk to `bloom-core` directly.
- **Secret Manager** — GCP Secret Manager holds every real credential (model API keys, Enkrypt key, `HITL_WEBHOOK_URL`, Qdrant key) and injects them into Cloud Run via `--set-secrets` at deploy time, one secret per credential with least-privilege IAM per service — never a plain env var in the deploy command, never baked into an image. Exact commands in `docs/secrets.md`.

## Demo script (~3 min)

1. **The paper.** Paste/upload a masked discharge summary. Parser extracts JSON, stores chunks in Qdrant (visible tool call in the playground trace).
2. **The walkthrough.** Explainer answers in Kannada — point at the `search_discharge_context` call in the trace: "it retrieved before it spoke."
3. **The change.** "Doctor stopped the blue tablet from today." Medication agent updates and reads back the new schedule.
4. **The 11 PM question.** "Amma has slight fever, is that normal?" — trace shows Qdrant retrieval, then `run_safety_check` (Enkrypt), then the reassurance with the note's own threshold. Contrast: "she has chest pain" -> immediate call-the-doctor.
5. **The close.** "One problem statement, four problems solved — because every family faces all of them in the same hour, holding the same paper. And every clinical answer you saw was retrieved, checked, and grounded — never guessed."

## Q&A defenses

- **"Is this medical advice?"** No — agents only reflect the doctor's own discharge instructions, retrieved from Qdrant. Uncovered symptoms get one answer: call your doctor. Enkrypt enforces the policy on every triage draft.
- **"Hallucination?"** Three layers: parser flags ambiguity instead of guessing, answers are retrieval-grounded per session, Enkrypt gates the output.
- **"Privacy?"** Masked demo documents; per-session filtering in Qdrant; PII detection via Enkrypt; roadmap is on-device parsing (Gemma 3n).
- **"Why not ABDM/ABHA?"** ABHA moves records between hospitals (PS1). Bloom serves the family at home after discharge — a different moment; ABHA integration is roadmap.

## Roadmap (say, don't build)

WhatsApp delivery via Meta Cloud API (bridge design ready), TTS voice replies,
Gemma 3n on-device parsing, caregiver multi-patient view, ABDM/ABHA
integration.

Proactive dose-time reminders (`reminder-service/`, Google ADK + A2A) and
anonymized readmission-risk analytics (BigQuery, `analytics.ts`) are no
longer roadmap — both are implemented and live in the architecture above.

## Production readiness

- **Stateless (12-Factor):** medication + appointment state lives in Firestore (`PERSISTENCE=firestore`); services restart without data loss and scale horizontally. In-memory mode is local-demo only.
- **Observability:** OpenTelemetry spans on every LLM call and agent handoff, exported to Cloud Trace via OTLP — auditable clinical decisions, latency, token cost.
- **Security:** JWT auth + rate limiting at the API gateway, TLS 1.3 in transit, AES-256 at rest (Firestore default), PII detection via Enkrypt, pseudonymized (SHA-256) session ids in analytics, all real secrets sourced from GCP Secret Manager at deploy time (`docs/secrets.md`) rather than plain env vars.
- **Analytics:** BigQuery ingests anonymized interaction events (no free text) powering readmission-risk insight.
- **Human safety net:** every RF-1/RF-3 triage verdict escalates to a human on-call queue in parallel with the AI's own reply (`escalateToHitl` in `tools.ts`) — a slow or failing webhook never delays the caregiver's answer, and a failed delivery is written to a dead-letter log instead of being silently dropped.
- **Offline sync correctness:** `ingest_offline_parse` rejects a stale submission (`status: "conflict"`) instead of letting an out-of-order offline write clobber fresher data already on the server — last-write-wins by trusted capture time.

## Deploy

```bash
# bloom-core
gcloud run deploy bloom-core --source . --region us-central1

# bloom-reminders (ADK, A2A)
cd reminder-service && gcloud run deploy bloom-reminders --source . --region us-central1
```

## Testing & CI

Every push and PR runs three jobs (`.github/workflows/ci.yml`): lint + format
check + typecheck + unit tests for `bloom-core` (Node/TypeScript), and
lint + format check + unit/integration tests for `bloom-reminders` (Python).

```bash
# bloom-core
npm run lint && npm run format:check && npm run typecheck && npm test

# bloom-reminders
cd reminder-service
pip install -r requirements-dev.txt
ruff check . && ruff format --check . && pytest -v
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the checks to run
before opening a PR.

## License

[MIT](LICENSE)

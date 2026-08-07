# Deploying Bloom to a public Cloud Run URL

Three services, one deploy command each. No Docker build step needed locally —
`gcloud run deploy --source .` builds the container in the cloud from each
`Dockerfile`. Qdrant uses Qdrant Cloud's free tier instead of self-hosting on Cloud Run,
since Cloud Run is stateless and Qdrant needs persistent disk — this sidesteps that
entirely and costs nothing.

## 0. Prerequisites (one-time)

```bash
gcloud config get-value project        # confirm you're on the right project
gcloud beta billing projects describe $(gcloud config get-value project) \
  --format="value(billingEnabled)"     # must print "True"
```

If billing isn't enabled: Console → Billing → link a billing account to this project.
GCP's free tier covers Cloud Run's first 2M requests/month and won't charge without
you separately upgrading — linking a card is a platform requirement, not a bill.

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
```

## 1. Qdrant Cloud (free tier, ~2 min)

1. [cloud.qdrant.io](https://cloud.qdrant.io) → sign up → Create Cluster (free tier, 1GB).
2. Copy the cluster URL and API key.

## 2. Firestore (native mode, one-time)

```bash
gcloud firestore databases create --location=us-central1
```

## 3. Secrets

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "YOUR_QDRANT_API_KEY" | gcloud secrets create qdrant-api-key --data-file=-
# Optional — omit and the app runs with the local safety-rule fallback:
echo -n "YOUR_ENKRYPT_API_KEY" | gcloud secrets create enkrypt-api-key --data-file=-
```

## 4. Deploy `bloom-reminders` (Python/ADK) first — bloom-core needs its URL

```bash
cd reminder-service
gcloud run deploy bloom-reminders \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets=GOOGLE_API_KEY=gemini-api-key:latest \
  --set-env-vars=ADK_MODEL=gemini-3.6-flash,DEMO_MODE=0

# copy the printed Service URL, e.g. https://bloom-reminders-xxxxx-uc.a.run.app
```

## 5. Deploy `bloom-core` (Mastra) — the main backend

```bash
cd ..
gcloud run deploy bloom-core \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets=GOOGLE_GENERATIVE_AI_API_KEY=gemini-api-key:latest,QDRANT_API_KEY=qdrant-api-key:latest \
  --set-env-vars=PERSISTENCE=firestore,QDRANT_URL=YOUR_QDRANT_CLOUD_URL,REMINDER_SERVICE_URL=https://bloom-reminders-xxxxx-uc.a.run.app,GEMINI_CHAT_MODEL=gemini-3.6-flash,GEMINI_EMBEDDING_MODEL=gemini-embedding-001

# copy this Service URL too, e.g. https://bloom-core-yyyyy-uc.a.run.app
```

## 6. Deploy `bloom-web` (the caregiver UI) — this is the link you'll actually share

```bash
cd web-client
gcloud run deploy bloom-web \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars=BLOOM_API_BASE=https://bloom-core-yyyyy-uc.a.run.app

# this Service URL is your public link, e.g. https://bloom-web-zzzzz-uc.a.run.app
```

`server-ui.js` was updated to read `BLOOM_API_BASE` at request time and inject it into
`index.html`'s `window.BLOOM_API_BASE` (previously hardcoded to `localhost:4111`, which
would have silently broken every API call once deployed — a static file server has no
build step to substitute env vars into JS at build time, so this does it per-request
instead). Local dev is unaffected: omit the env var and it falls back to `localhost:4111`
exactly as before.

## 7. Verify

```bash
curl https://bloom-core-yyyyy-uc.a.run.app/health 2>/dev/null || \
curl https://bloom-reminders-xxxxx-uc.a.run.app/health
```

Then open the `bloom-web` URL in a browser — that's the public link.

## Notes

- Skipping the API Gateway (JWT auth layer) for this first public deploy — `bloom-web`
  talks to `bloom-core` directly. Fine for a hackathon demo link; §6 of the PRD
  documents the gateway as the production-hardened path.
- Each `gcloud run deploy` re-run redeploys that one service with the latest code —
  useful after future fixes, no need to repeat the earlier steps.
- Cost: with `--allow-unauthenticated` and Cloud Run's pay-per-request billing, an idle
  demo link costs effectively $0 — you're only billed for requests actually served.

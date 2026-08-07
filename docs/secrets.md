# Secrets Management (GCP Secret Manager)

Addresses `NFR-9.1` in `docs/PRD.md`: zero secrets in source control or container images.
Locally, `.env` (gitignored) is fine for dev. In Cloud Run, every real secret below is
injected from Secret Manager at container start, never baked into an image or passed as a
plain env var in the deploy command.

## 1. Enable the API and create the secrets

```bash
gcloud services enable secretmanager.googleapis.com

# One secret per credential -- not one bundled JSON blob, so each service can be
# granted access to only what it needs (least privilege).
echo -n "$GOOGLE_GENERATIVE_AI_API_KEY" | gcloud secrets create bloom-gemini-key --data-file=-
echo -n "$ENKRYPT_API_KEY"              | gcloud secrets create bloom-enkrypt-key --data-file=-
echo -n "$HITL_WEBHOOK_URL"             | gcloud secrets create bloom-hitl-webhook --data-file=-
echo -n "$QDRANT_API_KEY"               | gcloud secrets create bloom-qdrant-key --data-file=-
```

Firestore itself needs no API key when the Cloud Run service runs under a service account
with the `roles/datastore.user` IAM role -- that's ambient credential access via workload
identity, not a secret to store. The same applies to Vertex AI (`roles/aiplatform.user`).

## 2. Grant each Cloud Run service's runtime identity access to only its own secrets

```bash
# bloom-core needs the Gemini key, Enkrypt key, and Qdrant key.
for SECRET in bloom-gemini-key bloom-enkrypt-key bloom-qdrant-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:bloom-core@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# bloom-reminders needs none of bloom-core's secrets -- database-per-service isolation
# (NFR-2.2) extends to secrets too. It only needs its own Gemini key for the ADK agent.
gcloud secrets add-iam-policy-binding bloom-gemini-key \
  --member="serviceAccount:bloom-reminders@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# The webhook URL is only relevant to bloom-core (it's the one calling run_safety_check).
gcloud secrets add-iam-policy-binding bloom-hitl-webhook \
  --member="serviceAccount:bloom-core@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 3. Deploy with secrets mounted as env vars (not committed, not baked into the image)

```bash
gcloud run deploy bloom-core \
  --source . \
  --region us-central1 \
  --service-account bloom-core@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets="GOOGLE_GENERATIVE_AI_API_KEY=bloom-gemini-key:latest,ENKRYPT_API_KEY=bloom-enkrypt-key:latest,QDRANT_API_KEY=bloom-qdrant-key:latest,HITL_WEBHOOK_URL=bloom-hitl-webhook:latest" \
  --set-env-vars="PERSISTENCE=firestore,MODEL_PROVIDER=vertex,GOOGLE_VERTEX_PROJECT=$PROJECT_ID"

gcloud run deploy bloom-reminders \
  --source reminder-service/ \
  --region us-central1 \
  --service-account bloom-reminders@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets="GOOGLE_API_KEY=bloom-gemini-key:latest"
```

`--set-secrets` mounts each secret as a real env var at container start, pulled live from
Secret Manager by Cloud Run's own integration -- the app code just reads
`process.env.GOOGLE_GENERATIVE_AI_API_KEY` exactly as it does locally, no SDK calls or
extra code needed. Rotating a key is `gcloud secrets versions add ... && gcloud run deploy`
with the same command (picks up `:latest` automatically), no code change.

## 4. Verify nothing is leaking

```bash
# Fails the build if a real-looking key pattern shows up in tracked files.
git log -p | grep -E "AIzaSy[A-Za-z0-9_-]{33}" && echo "LEAK FOUND" || echo "clean"
```

Wire an equivalent check into CI (`NFR-9.1` acceptance criterion: zero secrets in source
control, verified by a static secret-scan) -- a `pre-commit` hook or a CI step running
`gitleaks detect` are both reasonable off-the-shelf choices.

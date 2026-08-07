# Bloom API Gateway

GCP API Gateway sitting in front of `bloom-core`, handling JWT authentication
and rate limiting (NFR-8.1/8.2 in `docs/PRD.md`) so `bloom-core` itself never
needs to implement auth.

## What this is

`openapi2-config.yaml` is a real, deployable API Gateway config — not a
diagram placeholder. It uses Google-signed ID tokens for auth
(`google_id_token` security definition) and a per-minute request quota for
rate limiting, proxying to the `bloom-core` Cloud Run service.

**Scope note:** API Gateway's OpenAPI 2.0 backend requires each proxied path
declared explicitly (no wildcard passthrough for Mastra's full REST
surface). The spec covers what `web-client/public/app.js` actually calls:
`GET /api/agents` (connectivity check), `POST /api/agents/{agentId}/generate`
(chat, parsing, triage), and `POST /api/tools/{toolId}/execute` (medication
schedule, mark-taken, follow-ups). Add more `paths:` entries here if the
client starts using other Mastra endpoints (e.g. memory threads).

## Deploy

1. Deploy `bloom-core` to Cloud Run first (see the root `README.md`), and
   note its URL.
2. Edit `openapi2-config.yaml`: replace `host`, the `x-google-backend`
   address with your real `bloom-core` URL, and optionally
   `x-google-audiences` if you want to restrict to a specific OAuth client.
3. Enable the API Gateway API and create a service account with
   `roles/run.invoker` on `bloom-core`:
   ```bash
   gcloud services enable apigateway.googleapis.com servicemanagement.googleapis.com servicecontrol.googleapis.com
   gcloud iam service-accounts create bloom-gateway-sa
   gcloud run services add-iam-policy-binding bloom-core \
     --member="serviceAccount:bloom-gateway-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/run.invoker" --region=us-central1
   ```
4. Create the API, config, and gateway:
   ```bash
   gcloud api-gateway apis create bloom-gateway --project=YOUR_PROJECT_ID

   gcloud api-gateway api-configs create bloom-gateway-config \
     --api=bloom-gateway --openapi-spec=openapi2-config.yaml \
     --project=YOUR_PROJECT_ID \
     --backend-auth-service-account=bloom-gateway-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com

   gcloud api-gateway gateways create bloom-gateway \
     --api=bloom-gateway --api-config=bloom-gateway-config \
     --location=us-central1 --project=YOUR_PROJECT_ID
   ```
5. Point `web-client` at the gateway's URL (printed by the `gateways
create` command), not at `bloom-core` directly — edit the inline config
   in `web-client/public/index.html`:
   ```html
   <script>
     window.BLOOM_API_BASE = "https://your-gateway-url";
   </script>
   ```

## Auth model

Callers must send a Google-signed ID token (`Authorization: Bearer <token>`).
API Gateway validates it against Google's public JWKS and forwards the
verified claims to `bloom-core` in the `X-Apigateway-Api-Userinfo` header.
This repo doesn't ship a login UI yet — see `web-client/README.md`'s
roadmap note — but any client capable of obtaining a Google ID token (e.g.
Firebase Auth, Google Identity Services) works against this gateway as-is.

## What does this change?

<!-- One or two sentences. -->

## Which service(s)?

- [ ] bloom-core (root, Mastra)
- [ ] bloom-reminders (`reminder-service/`)
- [ ] bloom-web (`web-client/`)
- [ ] bloom-gateway (`api-gateway/`)

## Checklist

- [ ] `npm run lint && npm run format:check && npm run typecheck && npm test` pass
- [ ] `ruff check . && ruff format --check . && pytest -v` pass (if `reminder-service/` touched)
- [ ] Tests added/updated for the behavior change
- [ ] No secrets or real API keys in the diff

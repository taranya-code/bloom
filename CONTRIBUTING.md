# Contributing to Bloom

Thanks for your interest in improving Bloom. This project has four independently
deployable services — see the README's Services table for the layout.

## Setup

```bash
npm install                      # bloom-core (root)
cd reminder-service && pip install -r requirements-dev.txt   # bloom-reminders
```

Copy `.env.example` to `.env` (and `reminder-service/.env.example` to
`reminder-service/.env`) and fill in the keys you need locally.

## Before opening a PR

Run the same checks CI runs:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test

cd reminder-service
ruff check . && ruff format --check . && pytest -v
```

## Guidelines

- Keep services independently deployable — avoid new direct dependencies between
  `bloom-core`, `bloom-reminders`, `bloom-web`, and `bloom-gateway` outside of the
  documented A2A/HTTP contracts.
- Add or update tests for any behavior change (`src/mastra/__tests__/` for
  TypeScript, `reminder-service/tests/` for Python).
- Never commit real secrets — use `.env.example` files as the template and see
  `docs/secrets.md` for how production credentials are managed.
- Run `npm run format` / `ruff format .` before committing to avoid noisy diffs.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs. actual behavior, and
which service is affected (`bloom-core`, `bloom-reminders`, `bloom-web`, or
`bloom-gateway`).

# STOCVEST

Signal intelligence platform that surfaces technical patterns, AI-synthesized signal data, and multi-broker execution tools for self-directed traders.

## Stack

- **Frontend:** Next.js on Vercel (`stocvest.app`)
- **Backend:** Python Lambdas on AWS
- **Market data:** Polygon.io (Stocks Advanced + Options Starter + Currencies Starter)
- **Brokers:** IBKR (TWS via ib_insync) + ETrade (OAuth REST)
- **AI synthesis:** Claude API (Sonnet)
- **Database:** DynamoDB
- **Cache:** ElastiCache Redis

## Project structure

```
stocvest/
  data/           Market data models + Polygon.io client
  indicators/     Technical indicators engine (SMA, EMA, RSI, MACD, VWAP, BB, ATR, ADX, …)
  signals/        Signal engine — swing + day trading (Phase 2/2.5)
  brokers/        Broker adapters — IBKR, ETrade, Mock (Phase 3)
  api/            Lambda handlers + API Gateway (Phase 4)
  utils/          Config, logging

tests/
  data/           Polygon client tests (mocked)
  indicators/     Indicator unit tests
  signals/        Signal engine tests
  brokers/        Broker adapter tests
```

**Docs:** [`docs/CONTEXT.md`](docs/CONTEXT.md) (session status) · [`docs/BACKLOG.md`](docs/BACKLOG.md) (planned work) · [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) (API + broker contracts)

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# fill in POLYGON_API_KEY etc.
```

## Run tests

```bash
pytest tests/ -q
```

On Windows, if `pytest` is not on `PATH`, use `python -m pytest tests/ -q`. Current regression baseline: **`docs/CONTEXT.md` §13** (exact passed/skipped counts).

## CI/CD (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

**On every push and pull request**

- **Backend:** Python 3.11, `pip install -e .`, `pytest tests/ -q`, `terraform fmt -check` in `infra/`.
- **Frontend:** Node 20, `npm ci` / `npm run build` / `npm run test -- --silent` in `frontend/`.

**On push to `main` only** (after the checks above succeed on that run)

- **AWS:** Build one Lambda deployment zip (`scripts/build_lambda_package.sh`), upload to S3, then `aws lambda update-function-code` for each `stocvest-development-api-*` function (same artifact; dispatch uses `STOCVEST_LAMBDA_MODULE` from Terraform).
- **Vercel:** `POST` to the production [deploy hook](https://vercel.com/docs/deployments/deployment-methods#deploy-hooks).

Configure these in the GitHub repository (**Settings → Secrets and variables**). Do not commit real values.

| Name | Type | Purpose |
|------|------|--------|
| `AWS_ACCESS_KEY_ID` | Secret | IAM user or role key for CI deploy |
| `AWS_SECRET_ACCESS_KEY` | Secret | IAM secret for CI deploy |
| `AWS_REGION` | Secret | e.g. `us-east-1` (must match Terraform `aws_region`) |
| `VERCEL_DEPLOY_HOOK_URL` | Secret | Vercel production deploy hook URL |
| `STOCVEST_LAMBDA_S3_BUCKET` | **Variable** (not secret) | S3 bucket for `lambda/api-<sha>.zip` artifacts |

The IAM principal behind `AWS_*` needs at least: `s3:PutObject` on `arn:aws:s3:::STOCVEST_LAMBDA_S3_BUCKET/lambda/*`, and `lambda:UpdateFunctionCode` (and `lambda:GetFunction`) on `arn:aws:lambda:REGION:ACCOUNT:function:stocvest-development-api-*`.

### Lambda secrets (Terraform)

API keys are **not** set on the Lambda environment. Terraform creates **`stocvest/lambda-runtime`** in Secrets Manager (JSON: `POLYGON_API_KEY`, `ANTHROPIC_API_KEY`, `STOCVEST_INTERNAL_ANALYSIS_KEY`) and sets **`STOCVEST_LAMBDA_RUNTIME_SECRET`** on each function to that secret’s name. `get_settings()` loads the JSON at cold start (`stocvest/utils/config.py`). Rotate keys with **`aws secretsmanager put-secret-value`** (or the console); if you manage secret values only outside Terraform, add `lifecycle { ignore_changes = [secret_string] }` to `aws_secretsmanager_secret_version.lambda_runtime` so `terraform apply` does not overwrite them.

## Project status (high level)

**Source of truth:** [`docs/CONTEXT.md`](docs/CONTEXT.md) §1–§3 — shipped tracks, implemented areas, and near-term ops (Terraform apply, secrets, CI).

| Area | Notes |
|------|--------|
| Core signals, scanner, brokers, HTTP API | Shipped (see CONTEXT §1) |
| Next.js frontend (dashboard, landing, legal, BFF) | Shipped — compact **PDT** pill, **Market Intelligence** (ranked news, tabs); see CONTEXT §1–§2 |
| Terraform / AWS | Modules in `infra/`; **apply** and production wiring may still be pending (CONTEXT §3) |
| Phase 7 (E2E, audits, extended paper validation) | Planned — BACKLOG **P1** |

Historical phase labels in older READMEs are obsolete; use **git `main`** + **CONTEXT** for what exists today.

## Rules

- Never hardcode credentials — always AWS Secrets Manager
- Never log prices, accounts, or credentials; use structured logging and redaction helpers where user-supplied text or tokens could reach logs (`stocvest/utils/log_privacy.py`)
- Treat API **`user_id`** as server-derived from the JWT on protected routes — do not trust client body fields for identity
- PDT rule is non-negotiable — always enforced, never bypassed
- Paper trading required (minimum 2 weeks) before live trading

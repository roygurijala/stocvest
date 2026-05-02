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
pytest tests/ -v
```

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

## Build phases

| Phase | Status |
|-------|--------|
| 1 — Core infrastructure (Polygon client, indicators) | ✅ Complete |
| 2 — Swing trading signal engine | 🔜 Next |
| 2.5 — Day trading scanner | 🔜 |
| 3 — Broker layer (IBKR, ETrade) | 🔜 |
| 4 — API layer (Lambda + API Gateway) | 🔜 |
| 5 — Frontend (Next.js) | 🔜 |
| 6 — Infrastructure (Terraform) | 🔜 |
| 7 — Testing & hardening | 🔜 |

## Rules

- Never hardcode credentials — always AWS Secrets Manager
- Never log prices, accounts, or credentials
- PDT rule is non-negotiable — always enforced, never bypassed
- Paper trading required (minimum 2 weeks) before live trading

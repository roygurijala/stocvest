# STOCVEST

Multi-broker swing + day trading signal platform.

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

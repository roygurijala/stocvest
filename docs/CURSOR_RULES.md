# STOCVEST — Cursor AI Rules

You are working on STOCVEST, a multi-broker swing + day trading signal platform.

## Before writing any code
Always read **`docs/CONTEXT.md`** and **`docs/BACKLOG.md`** in full. CONTEXT holds shipped vs pending status, legal rules, immutable contracts, and **session rules (§13)** including exact test baselines. Never assume — check it. For **Market Intelligence** / ranked news (dashboard), see CONTEXT §2 (`news_relevance.py`, `passes_market_intelligence_gate`, BFF `GET /v1/market/news`).

## Phase / scope discipline
- **Source of truth:** `docs/CONTEXT.md` §1 (status table) and §3 (ops / blockers), not the historical “Phase N” labels below.
- Complete the **user-agreed** slice (or backlog item) before expanding scope; every change should keep **`pytest tests/ -q`** and **`cd frontend && npm run test`** green when touching those trees.
- If asked to skip tests or contracts, flag it and ask for confirmation.

## Code rules
- Never hardcode credentials — always use `stocvest/utils/config.py` (reads from env)
- Never log prices, account numbers, or credentials; sanitize user-supplied free text before persistence (`stocvest/api/text_sanitize.py`); use `stocvest/utils/log_privacy.py` where logs might include PII or large payloads
- All market data must flow through canonical types in `stocvest/data/models.py`
- No raw Polygon dicts outside of `stocvest/data/polygon_client.py`
- All indicator math lives in `stocvest/indicators/core.py` — pure functions only
- PDT rule (max 3 day trades in 5 days under $25k) is non-negotiable — always enforce

## Testing rules
- Every new module gets a corresponding test file in `tests/`
- Tests are marked `@pytest.mark.unit` (no network) or `@pytest.mark.integration`
- Mock all HTTP calls with `respx`, all AWS calls with `pytest-mock`
- Run `pytest tests/ -q` (or `python -m pytest tests/ -q` on Windows) and frontend tests before calling work complete; match counts to **CONTEXT.md §13**.

## Architecture
- Backend: Python async (httpx, asyncio) — Lambda-compatible, no Django/Flask
- Data: Pydantic v2 models throughout — no plain dicts crossing module boundaries
- Config: pydantic-settings via `get_settings()` — never `os.getenv()` directly
- Logging: always use `get_logger(__name__)` from `stocvest/utils/logging.py`

## When uncertain
- Flag it explicitly rather than guessing, especially for:
  - Financial math (RSI, ATR, options Greeks)
  - Broker API behaviour (IBKR TWS quirks, ETrade OAuth)
  - AWS service limits or DynamoDB design
  - PDT rule edge cases

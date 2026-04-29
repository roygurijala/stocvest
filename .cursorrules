# STOCVEST — Cursor AI Rules

You are working on STOCVEST, a multi-broker swing + day trading signal platform.

## Before writing any code
Always read `docs/CONTEXT.md` first. It contains the full build history,
key decisions, immutable contracts, and phase order. Never assume — check it.

## Phase discipline
- Current phase: **Phase 2 — Swing Trading Signal Engine**
- Complete the current phase fully before touching the next
- Every phase must have passing tests before moving on
- If asked to skip ahead, flag it and ask for confirmation

## Code rules
- Never hardcode credentials — always use `stocvest/utils/config.py` (reads from env)
- Never log prices, account numbers, or credentials
- All market data must flow through canonical types in `stocvest/data/models.py`
- No raw Polygon dicts outside of `stocvest/data/polygon_client.py`
- All indicator math lives in `stocvest/indicators/core.py` — pure functions only
- PDT rule (max 3 day trades in 5 days under $25k) is non-negotiable — always enforce

## Testing rules
- Every new module gets a corresponding test file in `tests/`
- Tests are marked `@pytest.mark.unit` (no network) or `@pytest.mark.integration`
- Mock all HTTP calls with `respx`, all AWS calls with `pytest-mock`
- Run `pytest tests/ -v` before saying a phase is complete

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

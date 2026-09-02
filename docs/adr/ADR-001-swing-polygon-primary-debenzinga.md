# ADR-001 — Swing-first, Polygon-primary; de-Benzinga dependency

**Status:** Accepted — **Phases 1–8 complete (2026-09-02)**  
**Date:** 2026-09-01  
**Authors:** Product + engineering (user-agreed swing-first, cost reduction)

## Context

- Benzinga REST/WebSocket keys in AWS Secrets Manager return **HTTP 401** (subscription expired or revoked).
- Swing trading depends on **structure, trend, sector, macro, and earnings risk** — not millisecond breaking news.
- Polygon (bars, snapshots, reference news), EDGAR (8-K), and Finnhub (earnings calendar) already cover most swing needs at lower cost.
- Perplexity Sonar and Claude are **metered** — suitable for on-demand research (deep dive, assistant), not bulk composite scoring.

## Decision

**Retire Benzinga from the swing hot path** and converge on:

| Capability | Primary source | On-demand supplement |
|------------|----------------|----------------------|
| Headline news (swing) | Polygon reference news | Perplexity (thin coverage / user ask) |
| Material filings | EDGAR 8-K worker | — |
| Earnings dates | Finnhub → Polygon → FMP | — |
| Analyst / narrative context | — (drop from scoring) | Perplexity in assistant / deep dive |
| Intraday breaking news | Polygon (day desk only) | — |

Day desk may keep optional Benzinga behind a flag until a separate ADR retires it entirely.

## Consequences

- **Positive:** Lower vendor cost, faster swing composite (no 6s `get_multi` timeout), fewer false “news degraded” states.
- **Negative:** No structured analyst upgrade/downgrade chips in swing news layer; WIIM catalysts removed from swing.
- **Neutral:** Liquid US names still get Polygon headlines; Perplexity fills ADR/micro-cap gaps when gated.

## Implementation phases (one at a time)

| Phase | ID | Scope | Status |
|-------|-----|--------|--------|
| 1 | DBZ-1 | **Swing composite:** Polygon-only news; skip `BenzingaClient.get_multi`; emit `news_source=polygon_primary`; keep empty compatibility shell for `NewsAnalyzer` | **Done 2026-09-01** |
| 2 | DBZ-2 | **News worker:** Disable Benzinga WebSocket; EDGAR-only ingestion (+ optional Polygon poll) | **Done 2026-09-01** |
| 3 | DBZ-3 | **Swing params:** Lower `swing_composite.news_weight` (0.20 → 0.12); rebalance technical/sector | **Done 2026-09-01** |
| 4 | DBZ-4 | **Earnings:** Remove Benzinga fallback from `earnings_calendar.py`; Finnhub/Polygon/FMP only | **Done 2026-09-01** |
| 5 | DBZ-5 | **Perplexity gating:** Swing deep dive / assistant only; remove from bulk composite unless `article_count==0` + watchlist | **Done 2026-09-02** |
| 6 | DBZ-6 | **Assistant:** Drop Benzinga fetches from `assistant_symbol_context`; Polygon news + optional Perplexity | **Done 2026-09-02** |
| 7 | DBZ-7 | **Day composite + infra:** Feature-flag Benzinga off by default; remove secrets from ECS news worker | **Done 2026-09-02** |
| 8 | DBZ-8 | **Cleanup:** Deprecate `benzinga_feed_health` on swing responses; document in API_CONTRACTS | **Done 2026-09-02** |

Each phase ships with tests and a CONTEXT/BACKLOG update before the next phase starts.

## Phase 6 contract

- `fetch_assistant_symbol_context` uses **Polygon only** for live market data (no `BenzingaClient` calls).
- Optional **Perplexity Sonar** when `PERPLEXITY_API_KEY` is set:
  - News enrichment when Polygon returns fewer than 2 articles.
  - Analyst price targets for chart levels / forecast context (always attempted when key present).
- Legacy Benzinga-shaped fields on `AssistantSymbolContext` remain for backward-compatible serialization in tests; they are not populated by fetch.

## Phase 5 contract

- Swing composite entry points pass `perplexity_mode`:
  - **`off`** (default): bulk desk batch, scripts, tests — no Perplexity layers or analyst fallback.
  - **`deep_dive`**: `POST /v1/signals/composite/swing` (Trading Room) — full Perplexity news/macro + analyst targets; US thin coverage uses `on_demand` bypass (not legacy Benzinga thin heuristic).
  - **`watchlist_thin`**: watchlist maturation / ledger capture — news Perplexity only when `article_count==0` and symbol is on the user's default watchlist; no macro or analyst Perplexity.

## Phase 7 contract

- `STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED` (default **off**): when off, day composite skips `BenzingaClient.get_multi` / `ensure_analyst_feed` and uses `swing_news_source_bundle()` + Polygon reference news.
- Day composite responses include **`news_source`: `"polygon_primary"`** when Benzinga is disabled.
- Day composite entry points pass `perplexity_mode` (same semantics as Phase 5 swing):
  - **`off`** (default): bulk desk batch, scripts, tests — no Perplexity layers or analyst fallback.
  - **`deep_dive`**: `POST /v1/signals/composite` (Trading Room day desk) — full Perplexity news/macro + analyst targets; US thin coverage uses `on_demand` bypass.
  - **`watchlist_thin`**: watchlist maturation / ledger capture — news Perplexity only when `article_count==0` and symbol is on the user's default watchlist.
- ECS news worker Benzinga secret gating shipped in DBZ-2; signals Lambda receives `STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED` via Terraform (`day_composite_benzinga_enabled`, default false).

## Phase 4 contract

- Earnings resolution order: **Finnhub → Polygon → FMP** in both `earnings_calendar.py` and `earnings_calendar_fetch.py`.
- No `BenzingaClient` calls on the earnings hot path.

## Phase 3 contract (additive)

- Swing composite blend when `swing_composite` is unset (code default / legacy secrets):
  - `technical_weight=0.34`, `news_weight=0.12`, `macro_weight=0.15`, `sector_weight=0.19`,
    `geopolitical_weight=0.10`, `internals_weight=0.10`
- Day desk continues using the shared `composite` block unless `day_composite` is set in Secrets Manager.
- Explicit `swing_composite` in Secrets Manager overrides the code default.

## Phase 8 contract

- **`benzinga_feed_health`** is **omitted** from swing composite HTTP responses (`POST /v1/signals/composite/swing`).
- Clients use **`news_source": "polygon_primary"`** and the News layer object for feed context.
- Documented in **`docs/API_CONTRACTS.md`** §4.3 (Composite `benzinga_feed_health` deprecated on swing).
- Day composite unchanged: may still emit **`benzinga_feed_health`** only when **`STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED=1`**; omitted when Polygon-primary (default).

## Phase 1 contract (additive)

- Swing composite responses include **`news_source`: `"polygon_primary"`**.
- **`benzinga_feed_health`** was emitted in DBZ-1 for backward compatibility (all feeds **`unconfigured`**); **removed from swing responses in DBZ-8** — see Phase 8 contract.
- No change to six-layer verdict math in Phase 1 (weights unchanged until DBZ-3).

## References

- `stocvest/api/services/swing_composite_engine.py`
- `stocvest/data/benzinga_client.py`
- `stocvest/api/services/symbol_perplexity_enrichment.py`
- `docs/SIGNAL_ENGINE.md`

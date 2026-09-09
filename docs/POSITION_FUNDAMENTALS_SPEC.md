# Position fundamentals spec (POS-D1 data + POS-D2 scoring)

**Status:** POS-D1 shipped (data contracts). Pillar scoring formulas implemented in POS-D2.

**Last updated:** 2026-09-08

**Related:** [`adr/ADR-004-position-desk-long-term-investment.md`](./adr/ADR-004-position-desk-long-term-investment.md), [`FUNDAMENTALS_CONTEXT_SPEC.md`](./FUNDAMENTALS_CONTEXT_SPEC.md)

---

## Scope

This document defines:

1. **Data contracts** — how Position desk fetches and normalizes fundamentals (POS-D1).
2. **Pillar inputs** — which metrics feed F1–F5 (POS-D2 implements scoring).
3. **Peer set policy** — relative valuation denominator.
4. **Cache, rate limits, and failure modes** — no silent invention of numbers.

Swing/day desks remain **display-only** for fundamentals unless explicitly noted.

---

## Provider abstraction

| Module | Role |
|--------|------|
| `stocvest/data/fundamentals_models.py` | Canonical Pydantic types (`IncomeStatement`, `BalanceSheet`, …) |
| `stocvest/data/fundamentals_provider.py` | `FundamentalsProvider` protocol, `FMPFundamentalsProvider`, `FundamentalsProviderMock` |
| `stocvest/data/fundamentals_peer_resolver.py` | Bounded peer list for F4 relative bands |
| `stocvest/data/fmp_client.py` | Legacy swing backdrop helpers (revenue trend, earnings date) — **unchanged** |

Factory: `get_fundamentals_provider()` → FMP when `FMP_API_KEY` / Secrets `fmp_api_key` is set.

Bundle entry point for POS-D2:

```python
snapshot = await fetch_position_fundamentals_snapshot("AAPL", provider=...)
```

Returns `PositionFundamentalsSnapshot` with `configured`, `data_quality`, and all statement families.

---

## FMP endpoint map (stable API)

Base: `https://financialmodelingprep.com/stable`

| Provider method | FMP path | POS-D2 use |
|-----------------|----------|------------|
| `get_income_statements` | `/income-statement` | F1 margins, F2 revenue/EPS growth |
| `get_balance_sheets` | `/balance-sheet-statement` | F3 solvency |
| `get_cash_flows` | `/cash-flow-statement` | F1 FCF, F5 accruals proxy |
| `get_ratios` | `/ratios` | F1 ROE/ROIC, F3 coverage, F4 P/E bands |
| `get_key_metrics` | `/key-metrics` | F4 EV/EBITDA, P/FCF, market cap |
| `get_sector_peers` | `/stock-peers` | F4 sector-relative valuation |

**Parameters:** `symbol`, `period` (`quarter` \| `annual`), `limit` (clamped 1–40), `apikey`.

**Never raises:** empty list / `data_quality=unavailable` on missing key, HTTP errors, or malformed rows.

**Resilience (review hardening):**

- FMP ratio fields (ROE, margins) may arrive as whole percents (`22.5`) or decimals (`0.225`) — pillar scorers use `normalize_pct_rate()`.
- Valuation multiples reject non-positive P/E and P/FCF.
- Corrupt cached JSON (not explicit `"[]"`) triggers refetch instead of 24h empty serve.
- `fetch_position_fundamentals_snapshot` uses `return_exceptions=True` — one failed family does not block others.
- Analyzer sorts all statement rows newest-first via `prepare_snapshot()`.

## Cache keys (Redis, 24h TTL)

| Resource | Key pattern |
|----------|-------------|
| Income | `stocvest:fmp:position:income-statement:v1:{SYM}:{period}:{limit}` |
| Balance | `stocvest:fmp:position:balance-sheet-statement:v1:{SYM}:{period}:{limit}` |
| Cash flow | `stocvest:fmp:position:cash-flow-statement:v1:{SYM}:{period}:{limit}` |
| Ratios | `stocvest:fmp:position:ratios:v1:{SYM}:{period}:{limit}` |
| Key metrics | `stocvest:fmp:position:key-metrics:v1:{SYM}:{period}:{limit}` |
| Peers | `stocvest:fmp:position:peers:v1:{SYM}:{limit}` |

Cache key includes **period** and **limit** to prevent cross-request contamination.

---

## Rate limits & batch strategy

| Workload | Strategy |
|----------|----------|
| Deep dive (1 symbol) | Up to 6 FMP calls in parallel via `fetch_position_fundamentals_snapshot` — acceptable for on-demand |
| Universe scan (POS-D15) | Cheap ratio pre-filter before full snapshot; reuse 24h cache; batch by symbol with concurrency cap (implement in D15) |
| Free tier / missing key | `configured=false`; fundamentals layer **degraded** — no invented scores |

FMP plan limits are environment-specific — tune concurrency in the scan job, not in the provider.

---

## Peer set policy (F4 relative valuation)

**v1 (POS-D1):**

1. Primary: FMP `stock-peers` for the subject symbol.
2. Normalize: uppercase, dedupe, **exclude subject**, cap at 15 (configurable, max 25).
3. Empty peer list: F4 uses **historical self bands only** (5Y when ≥20 quarters) — never fabricate sector median.

**v1.1 (planned):**

- Fallback: top-N holdings of resolved sector ETF (`sector_mapper` → `DEFAULT_SECTOR_TO_ETF`).
- Last resort: broad market proxy (SPY constituents sample) — informational chip only.

---

## Data quality tiers (G9 gate input)

Function: `assess_snapshot_data_quality(snapshot)` in `fundamentals_models.py`.

| Tier | Rule (v1 heuristic) |
|------|---------------------|
| **high** | ≥4 of 5 families have ≥4 rows |
| **medium** | ≥2 families with ≥4 rows |
| **low** | ≥1 family with any rows |
| **unavailable** | No API key or no families |

Gem gate G9 requires **≥ medium**. POS-D2 may refine using per-pillar `data_quality`.

---

## Pillar catalog (scoring — POS-D2)

Each pillar emits: `pillar_id`, `score` (0–100), `verdict`, `reasoning`, `chips[]`, `data_quality`, `as_of_date`.

### F1 — Profitability & quality (20%)

| Input | Source |
|-------|--------|
| Gross / operating / net margin trend (YoY) | `ratios` + `income-statement` |
| ROE, ROIC (ROA for financials — sector override) | `ratios` |
| FCF margin | `cash-flow-statement` / revenue |
| Margin stability (σ over 8Q) | `ratios` series |

### F2 — Growth (20%)

| Input | Source |
|-------|--------|
| Revenue YoY (4Q rolling) | `income-statement` |
| EPS YoY | `income-statement` |
| 3Y revenue CAGR (≥12Q) | `income-statement` |
| Guidance direction | Benzinga / earnings feeds (reuse swing) |

### F3 — Balance sheet & solvency (20%)

| Input | Source |
|-------|--------|
| Net debt/EBITDA, interest coverage, current ratio | `ratios`, `balance-sheet-statement` |
| Red flag: coverage < 1.5 or D/E > sector p75 | ratios + peer set |

### F4 — Valuation (15%)

| Input | Source |
|-------|--------|
| P/E, P/FCF, EV/EBITDA vs peer median band | `ratios`, `key-metrics`, peers |
| **Value trap guard:** low P/E + falling earnings → verdict capped neutral | F2 + F4 joint rule |

### F5 — Earnings quality & consistency (15%)

| Input | Source |
|-------|--------|
| Beat/miss streak (4–8Q) | Benzinga + statements |
| Accruals proxy: (NI − OCF) / avg assets trend | statements |
| Revenue vs EPS divergence | statements |

**Aggregate layer score:** weighted F1–F5 → `clamp_layer_score` → directional via Signal Math Contract.

**Gem rank formula (discovery):**

`gem_rank = 0.45×fundamentals_layer + 0.20×technical + 0.15×sector + 0.10×macro + 0.10×min(F1..F5)`

---

## Sector overrides (POS-D2 stub → POS-AI-5)

Table-driven in `stocvest/signals/position_fundamentals/sector_overrides.py`
(`resolve_sector_override_flags(bucket) → SectorOverrideFlags`). Buckets are the internal
`SectorMapper` buckets (note REITs resolve to **`real_estate`**, not `reits`). The overrides
are deliberately conservative — metric selection, valuation de-emphasis, and suppression of
an inappropriate *generic* red flag — and never invent new numeric thresholds.

**Shipped (POS-AI-5):**

| Sector bucket (`SectorMapper`) | Flag | Effect |
|---|---|---|
| `banks`, `insurance`, `consumer_finance`, `investment_services` | `use_roa_not_roic` | F1 quality metric uses ROA (not ROIC/ROCE) |
| `banks` … + `real_estate`/`reits` | `structural_high_leverage` | F3 does **not** score raw D/E or fire the "Elevated leverage" red flag (surfaced as an informational chip); interest-coverage & liquidity checks still apply |
| `real_estate`/`reits` | `de_weight_valuation` + `valuation_note` | F4 −5 de-emphasis with chip "REIT — judge valuation on P/FFO, not P/E" (GAAP P/E distorted by depreciation) |
| `biotech`, `pharma` | `de_weight_valuation` | F4 −5 with chip "Pre-profit sector — valuation de-weighted" |

**Deferred to POS-AI-5 v2 (need verified FMP inputs / coordinated pillar-set change):**

| Target | Adjustment (not yet implemented) |
|---|---|
| Banks | F3 CET1 / NPL proxies; F4 P/TBV |
| REITs | F4 P/FFO recompute; F3 REIT-specific debt metrics |
| Energy / cyclicals | F1/F2 mid-cycle normalization chip |
| All | **F7** business-quality/moat proxies, **F8** capital allocation — behind `STOCVEST_POSITION_FUNDAMENTALS_V2_ENABLED` |

---

## Explicit non-goals

- No DCF / fair value price
- No LLM-generated pillar scores
- No scraping 13F/Form 4 in v1
- No change to swing/day composite math from this spec

---

## Tests

| Area | File |
|------|------|
| Models + data quality | `tests/data/test_fundamentals_models.py` |
| Provider (FMP mock + Mock) | `tests/data/test_fundamentals_provider.py` |
| Peer resolver | `tests/data/test_fundamentals_peer_resolver.py` |
| Pillar scoring F1–F5 + aggregate | `tests/signals/position_fundamentals/` |
| Fixtures | `tests/data/fixtures/fmp/*.json`, `tests/signals/position_fundamentals/conftest.py` |

All marked `@pytest.mark.unit` — no network.

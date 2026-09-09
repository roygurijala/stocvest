# ADR-004 — Position desk & AI-native investment intelligence

**Status:** Accepted — **POS-D0 only (2026-09-08)**  
**Date:** 2026-09-08 (vision expanded 2026-09-08 — AI-native investment platform)  
**Authors:** Product + engineering (Option C third desk + ambition: **best-in-class AI-assisted investment research**, not a black-box rating shop)  
**Supersedes / relates:** ADR-002 (swing-first validation — **Position adds long-horizon lane**); ADR-003 (Deep Dive tabs — **extended by POS-D7**); ADR-001 (Perplexity gating — **extended for investment research**); [`FUNDAMENTALS_CONTEXT_SPEC.md`](../FUNDAMENTALS_CONTEXT_SPEC.md); [`API_CONTRACTS.md`](../API_CONTRACTS.md) § AI explanations + assistant; **does not** change day/swing math unless a phase explicitly says so.

## Context

The Trading Room Deep Dive today supports **two independent desks**:

| Desk | API | Typical hold | Primary bars | Fundamentals today |
|------|-----|--------------|--------------|-------------------|
| **Day** | `POST /v1/signals/composite/real` | Hours | 1-minute | Never |
| **Swing** | `POST /v1/signals/composite/swing` | Days (~5 valid) | Daily | Display-only backdrop (`fundamental_context`) |

User request: when reviewing a symbol in depth, show a **long-horizon investment setup** alongside swing — not as decorative context, but as a **third scored desk** with its own verdict, geometry, and validation story.

**Product ambition (2026-09-08):** Position desk is the foundation for STOCVEST as a **top-tier AI-assisted investment platform** — combining **transparent, deterministic fundamentals scoring** (not a black-box “AI score”) with **Claude/Perplexity synthesis** that explains *why* the engine read what it read, surfaces bull/bear cases, and answers follow-up questions with citations. Competitors like Danelfin optimize for a single opaque probability; generic LLMs optimize for fluent prose without auditable math. STOCVEST’s wedge is **glass-box intelligence**: scored pillars → validated ledger → AI narration that **cannot override** the engine.

**Why not extend swing?** Swing geometry, gates, and ledger are tuned for **multi-day** holds (`signal_valid_days: 5`, ATR stops, min R/R ~2.0). Long-horizon investing (roughly **1–12+ months**) needs different inputs (financial statement quality, valuation vs history, balance-sheet risk), wider stop semantics, slower validity, and a separate validation ledger — re-labeling swing would blur Mode Separation and corrupt swing telemetry.

**Existing assets we can reuse:**

- Six-layer composite plumbing (`CompositeScoreEngine`, confluence, evidence snapshots)
- `fundamental_context.py` + FMP client (revenue trend, earnings calendar) — **thin vs what Position needs**
- `swing_technical_analyzer.py` (SMA50/200, 60-session high) — **starting point, not sufficient**
- Deep Dive lane toggle pattern (`Day | Swing` in `deep-dive.tsx`)
- Structure engine (B80) for zone-based stops/targets
- Perplexity on-demand for thin coverage (ADR-001 DBZ-5)
- Signal validation ledger (`SignalHistory`, `mode=day|swing`)
- **AI stack (shipped):** STOCVEST Assistant (`assistant_prompts.py`), `POST /v1/signals/ai/explanations` (`setup_read`, `signal_capture`), `AiSetupRead`, market brief Claude narrative, multi-symbol compare (A7), web search fallback (Perplexity, flag-gated), deterministic fallbacks for free users

**Gaps (must build):**

- No `mode=position` in models, ledger, assistant, or feed
- No `POST /v1/signals/composite/position`
- No scored fundamentals layer (by design for swing/day — see FUNDAMENTALS_CONTEXT_SPEC)
- No weekly/monthly technical analyzer or position geometry policy
- No position discovery feed or validation loop
- **No investment-specific AI packet** — assistant lacks pillar-level context, bull/bear case structure, or citation-backed 10-K/SEC research mode
- **No transparent investment screener** (ranked position candidates with pillar breakdown)

---

## Decision

Introduce a third desk: **Position** (`mode=position`, UI label **Position** or **Investment** — canonical API value **`position`**).

| Lane | Goal |
|------|------|
| **MODE** | Hard Mode Separation: day, swing, and position never share composite cache keys, verdict language, or gate justification |
| **FUND** | Fundamentals are **first-class scored inputs** for Position (not backdrop-only) |
| **TECH** | Structural trend on **weekly + daily** bars (months horizon), not ORB/VWAP |
| **GEO** | Wider stop/target geometry + longer `signal_valid_days` |
| **TRUST** | Separate ledger + validation loop before position alerts |
| **AI** | **Glass-box AI** — LLM narrates and researches; **never** replaces pillar math or upgrades verdicts |
| **LEGAL** | Informational framing only — stronger disclaimers than swing; counsel on thesis copy |

**North star (investment platform):**

> STOCVEST **finds long-horizon gem candidates** the market may be under-appreciating — ranked by **very strong fundamentals plus structural, sector, and macro confirmation** — and lets any user **look up a symbol** to see the same transparent pillar read. AI explains every candidate; it never hides the math in one score or tells you what to buy.

**Two equal product journeys (both required):**

| Journey | User intent | Primary surface | Engine path |
|---------|-------------|-----------------|-------------|
| **A — Discover gems** | “Show me the best long-term opportunities you can find” | **`/dashboard/invest`** — ranked **Gem Candidates** table, filters, weekly refresh | Universe scan → position composite batch → rank + gate |
| **B — Lookup symbol** | “How does *this* stock score for the long term?” | Global symbol search → Deep Dive **Position** tab (or `/dashboard/invest?symbol=…`) | On-demand `POST /v1/signals/composite/position` |

Journey A is **not** an afterthought — it is how the product earns trust (“STOCVEST found these names”). Journey B is the diligence path when the user already has a ticker. **Same engine, same pillars, same gates** for both.

**North star (Deep Dive — unchanged):**

> From Deep Dive, a user can compare **three independent reads** on the same symbol — intraday (Day), multi-day swing (Swing), and long-horizon investment quality (Position) — without any desk implying the others are wrong or substitutable.

**Hold-period contract (v1):**

- **Target framing:** 1–12 months (extendable in v2)
- **`signal_valid_days`:** **90** default (Secrets-tunable); re-evaluate on weekly bar close
- **Geometry:** structural stop (major support / SMA200 zone), targets at next major resistance and/or analyst consensus PT band — **honest R/R** separate from swing T1/T2 copy

---

## Consequences

- **Positive:** Differentiated vs black-box screener apps **and** generic ChatGPT — transparent pillars + AI explainability; clear product story for investors; fundamentals earn weight where they belong; reuses composite + assistant infrastructure.
- **Negative:** Large multi-phase effort; FMP + LLM cost + rate limits; Lambda CPU on deep dive; assistant prompt + cache key proliferation; counsel review on investment + AI thesis copy.
- **Neutral:** Swing remains primary for ADR-002 validation loop until Position ledger soaks; day desk unchanged.

---

## Competitive differentiation (why this can be best-in-class)

| Capability | Typical black-box screener | Generic AI chat | STOCVEST target (ADR-004) |
|------------|---------------------------|-----------------|---------------------------|
| Score transparency | Single probability / AI rating | None | **Six fundamental pillars + six layers**, each with score, verdict, reasoning |
| Horizon clarity | One implicit horizon | User must specify | **Three desks** — day / swing / position, never blended |
| Risk geometry | Often absent | Hallucinated levels | **Structure-engine stops/targets** with honesty panel |
| Proof / accountability | Marketing backtests | None | **Signal validation ledger** per mode |
| AI role | Hidden in the score | Replaces analysis | **Narrates deterministic output**; cites pillar IDs + sources |
| Research depth | Static factors | Broad but ungrounded | **FMP statements + EDGAR + Perplexity** with citation cards |

**Invariant:** AI is a **research and explanation layer**, not the scoring engine. Users should always be able to answer: “Which pillar dragged the read down?” without asking the model.

---

## Gem discovery — what “strong long-term opportunity” means

The product **surfaces candidates** (UI label: **Gem candidate** or **Strong quality** — never “Buy” or “Recommended pick”). A name qualifies only when **fundamentals are very strong** *and* supporting layers do not contradict the thesis.

### Gem qualification gates (v1 — all must pass for “Gem candidate” tier)

| Gate | Rule (defaults — Secrets-tunable) | Rationale |
|------|-----------------------------------|-----------|
| **G1 — Fundamentals strength** | Fundamentals layer score **≥ 72** AND each of F1–F5 **≥ 60** (no weak pillar) | “Very strong fundamentals” — no hidden weak link |
| **G2 — Earnings quality** | F5 not bearish; accruals flag not triggered | Avoid accounting red flags |
| **G3 — Balance sheet** | F3 bullish or neutral; no solvency red-flag chip | Long-term survivability |
| **G4 — Valuation sanity** | F4 not bearish **unless** F1+F2 both bullish (quality compounder exception) | Value trap guard |
| **G5 — Structural trend** | Position technical: price **above SMA200** OR base breakout stage; not in sharp breakdown | Long-term trend alignment |
| **G6 — Relative strength** | 6M RS vs SPY not bottom quartile of scan universe | Not a persistent laggard |
| **G7 — Macro / sector** | Macro regime ≠ `avoid`; sector layer not strongly bearish vs SPY | Environment not hostile |
| **G8 — Universe hygiene** | Passes `position_universe_filter` (liquid US, no leveraged/inverse ETFs) | Investable, not toxic |
| **G9 — Data quality** | Fundamentals `data_quality` ≥ `medium`; ≥4 pillars with high-quality inputs | No gems on junk data |

**Rank score (within qualified set):**  
`gem_rank = 0.45 × fundamentals_layer + 0.20 × technical_layer + 0.15 × sector_layer + 0.10 × macro_layer + 0.10 × min(F1..F5)` — transparent, documented in `POSITION_FUNDAMENTALS_SPEC.md`.

**Tiers (display only):**

| Tier | Criteria | Copy |
|------|----------|------|
| **Gem candidate** | Passes G1–G9 | “Passes strict quality gates — review pillars before any decision.” |
| **Strong quality** | Passes G1,G2,G3,G8,G9 but misses one of G5–G7 | “Strong fundamentals; structure or environment needs review.” |
| **Monitor** | Composite available but misses Gem/Strong | “Mixed read — see weakest pillar.” |
| **Insufficient** | Missing data or failed universe filter | Not shown in gem list |

### Universe scan (Journey A engine)

- **Universe v1:** US equities **≥ $2B market cap**, **≥ $20M avg daily dollar volume**, common stock only (configurable)
- **Batch job:** `position_universe_scan` — weekly (Sunday PM ET) + optional nightly delta for top movers; reuse scanner infra patterns, **separate** from swing desk batch
- **Output:** DynamoDB or S3 cache `PositionScanSnapshot` + API `GET /v1/signals/position/candidates?limit=50&tier=gem`
- **Cost:** fundamentals cached 24h; full composite only for names passing **cheap pre-filter** (FMP ratios quick screen) to limit FMP/Lambda spend
- **AI overlay (optional):** one-line “why this gem” from thesis packet for top 20 rows only — not for ranking

### Symbol lookup (Journey B)

- Reuse **session header global symbol search** → navigate to Deep Dive with **Position tab** pre-selected when opened from `/dashboard/invest`
- **`POST /v1/signals/composite/position`** — same payload as swing (symbol + bars fetch server-side)
- Show **full pillar grid + tier badge** even when symbol is **not** in gem list (“AAPL: Strong quality — F4 valuation elevated”)
- Assistant: “Is MSFT a gem?” → answers from **cached scan row** if fresh, else on-demand composite; cites pillars

**Legal framing:** “Gem candidate” = **passed internal quality gates for informational screening** — not a recommendation, solicitation, or guarantee of future performance.

---

## AI architecture — glass box (non-negotiable)

### Three-tier model

```
Tier 1 — Deterministic engine (source of truth)
  position_fundamentals_analyzer → pillar scores
  position_technical_analyzer + other layers → composite
  gates → decision_state, geometry

Tier 2 — Structured synthesis (optional Claude, paid-gated)
  position_thesis_packet.json → bull case / bear case / open questions
  setup_read type position_setup_read → Investment Read panel

Tier 3 — Conversational research (Assistant + Perplexity)
  User Q&A grounded in Tier 1 packet + citations
  Never changes Tier 1 scores from chat
```

### AI capabilities by surface

| Surface | Tier | Behavior |
|---------|------|----------|
| **Fundamentals grid** | 1 only | Pillar scores from engine; no LLM in the number |
| **Investment Read** | 2 | Claude `position_setup_read`; deterministic fallback cites pillars verbatim |
| **Bull / Bear cards** | 2 | Generated from `position_thesis_packet`; each bullet maps to `pillar_id` or `layer` |
| **“Ask about this investment”** | 3 | Assistant with `trading_mode=position` + full packet in page context |
| **Research this company** | 3 | Perplexity + EDGAR excerpt (POS-AI-4); citations required; no verdict change |
| **Compare NVDA vs AMD (investment)** | 3 | Extend A7 multi-symbol compare with **pillar side-by-side** table (deterministic) + AI summary of *differences*, not winner-picking |

### AI safety rules (add to `ASSISTANT_SYSTEM_PROMPT` in POS-AI-3)

1. **Never** output buy/sell/hold, allocation %, or “you should own.”
2. **Never** upgrade/downgrade `decision_state` or pillar scores based on chat.
3. **Always** reference desk scope: “On the **Position** desk (long-horizon quality)…”
4. **Always** surface uncertainty: missing pillars, low `data_quality`, stale filings.
5. **Cite** web/SEC sources when used; distinguish “engine read” vs “external fact.”
6. **Refuse** cross-desk substitution (“swing is quiet — buy for the long term instead”).

### Cost controls

- Tier 2 runs **once per composite fetch** (cache in Redis keyed by symbol + pillar hash + parameter_version)
- Tier 3 Perplexity: Position tab only + explicit user action (not bulk desk batch)
- Free tier: Tier 1 + deterministic Tier 2 fallback (same pattern as `setup_read` today)

---

## Fundamentals framework (Position desk)

Position fundamentals are **scored** (Stage A analyzer → 0–100 layer score → directional contribution). They **do not** replace counsel-approved disclaimers and **do not** output “buy/hold/sell” ratings.

### Design principles

1. **Quality over headline** — prefer multi-quarter trends to single earnings beats.
2. **Relative, not absolute “cheap”** — valuation vs **sector ETF peers** and **own 5-year history** (when data exists), never “undervalued” marketing copy.
3. **Fail soft** — missing filings → `unavailable` pillar, reduced confidence, never invent numbers.
4. **US equities first** — ADRs and illiquid names may be `monitor`-only until data quality ≥ medium.
5. **Provider abstraction** — implement behind `stocvest/data/fundamentals_provider.py` (FMP primary v1; mock in tests).

### Pillar catalog (v1 — all feed Position Fundamentals layer)

Each pillar produces: `status`, `score` (0–100), `verdict` (bullish/neutral/bearish), `reasoning` (1–2 sentences), `chips[]`, `data_quality`, `as_of_date`.

| Pillar ID | Weight (v1 default) | Metrics / rules | Primary source (v1) |
|-----------|---------------------|-----------------|---------------------|
| **F1 — Profitability & quality** | 20% | Gross / operating / net margin trend (YoY); ROE, ROIC (or ROA for financials); FCF margin; margin stability (σ over 8Q) | FMP `ratios`, `cash-flow-statement`, `income-statement` |
| **F2 — Growth** | 20% | Revenue YoY (4Q rolling), EPS YoY, 3Y revenue CAGR (when ≥12Q); guidance direction (reuse earnings/guidance feeds) | FMP + existing earnings calendar / EDGAR |
| **F3 — Balance sheet & solvency** | 20% | Net debt/EBITDA, interest coverage, current ratio, cash vs short-term debt; **red flag:** coverage < 1.5 or D/E > sector p75 | FMP `balance-sheet-statement`, `ratios` |
| **F4 — Valuation** | 15% | P/E, P/FCF, EV/EBITDA vs sector median band; **not** single-metric “cheap”; score **neutral** when extreme low P/E + falling earnings (value trap guard) | FMP `ratios`, `key-metrics`; sector median from peer set |
| **F5 — Earnings quality & consistency** | 15% | Beat/miss streak (4–8Q), accruals proxy (NI − OCF)/assets trend, revenue vs EPS divergence | FMP statements + existing `fundamental_context` beat logic |
| **F6 — Shareholder returns** (v1.1) | 10% | Dividend yield, payout ratio, 5Y dividend growth; omit when non-dividend name | FMP `ratios`, dividend history |
| **F7 — Business quality & moat proxies** (v2) | — | Gross margin vs 5Y band, R&D/revenue trend (growth sectors), SGA discipline, revenue concentration flags | FMP statements + SEC segment notes (POS-AI-5) |
| **F8 — Capital allocation** (v2) | — | Buyback vs debt paydown vs capex; dilution trend (shares outstanding) | FMP cash flow + equity statements |

**Sector overrides (required for best-in-class coverage):**

| Sector bucket | Pillar adjustments |
|---------------|-------------------|
| **Banks / insurance** | F3: CET1 / NPL proxies; F1: ROE not ROIC; F4: P/TBV not P/E |
| **REITs** | F4: P/FFO, AFFO; F3: debt metrics REIT-specific |
| **Biotech / pre-profit** | F4 de-weighted; F2 pipeline / cash runway pillar (informational, not bullish by default) |
| **Energy / cyclicals** | F1/F2 use mid-cycle normalization note in reasoning chips |

**SEC / narrative enrichment (AI-assisted, Tier 3 — not scored v1):**

- EDGAR 10-K **Risk Factors** + MD&A excerpt retrieval (`edgar_client.py` extend)
- Claude summarizes **material risks** with `[10-K §]` citations — display in Context tab, not composite score
- Perplexity for recent **management commentary** and industry headwinds (citation cards)

**Aggregate Fundamentals layer score:** weighted pillar blend (F1–F5 v1) → `clamp_layer_score` → maps to directional via `layer_score_direction` (Signal Math Contract).

**Sector peer set for relative valuation:** reuse `sector_mapper` → sector ETF holdings top-N or GICS peer list (document choice in POS-D1); fallback SPY broad market.

### Explicit non-goals (fundamentals v1)

- No DCF / intrinsic value / “fair value” price
- No automated portfolio allocation or position sizing
- No “Strong Buy” sell-side labels
- No LLM-generated pillar scores (AI **narrates** pillars; never **sets** them)
- No scraping insider Form 4 / 13F until POS-AI-6+ with counsel sign-off

### Relationship to swing `fundamental_context`

| Surface | Swing / Day | Position |
|---------|-------------|----------|
| `fundamental_context` backdrop | Display-only on swing composite | **Also** returned on position composite for UI chips, but **superseded for scoring** by Fundamentals layer detail object `position_fundamentals` |
| Composite score impact | None | Fundamentals layer weight default **0.30–0.35** of six layers (Secrets `position_composite`) |

---

## Six-layer stack (Position mode)

Same **layer names** as day/swing for assistant compatibility; **implementations differ**.

| Layer | Position implementation | Notes |
|-------|-------------------------|-------|
| **Technical** | `position_technical_analyzer.py` | Weekly bars (primary) + daily confirm; SMA50/200, 52w high/low, stage base (min 20 weeks), RS vs SPY 6M |
| **Fundamentals** | `position_fundamentals_analyzer.py` | Pillar catalog above — **new scored layer** |
| **Macro** | Extended lookback macro | Rates/inflation cycle labels; 63/45 thresholds may differ — document in Secrets |
| **Sector** | 3–6 month relative strength | Weekly sector ETF vs SPY |
| **News** | 30–90d lookback, structural only | Polygon + EDGAR; Perplexity on-demand in deep dive |
| **Geopolitical** | Structural exposure | Reuse geo analyzer with position sensitivity table |
| **Market Internals** | **Structural volatility regime** (`InternalsAnalyzer(mode="position")`) | Scores off the **VIX level only**; today's VIX move + intraday SPY/QQQ breadth/participation are excluded (reported `structural`) as tape noise over a multi-year hold. Degrades to neutral 50 when VIX is missing. **Future:** true 20/50-day advance-decline slow breadth. |

**Composite weights:** new Secrets block `position_composite` (e.g. fundamentals **0.32**, technical **0.22**, macro **0.15**, sector **0.12**, news **0.08**, geo **0.06**, internals **0.05**) — tune only via TUNING_PLAYBOOK after ledger soak.

---

## UI design (Deep Dive)

### Lane toggle (POS-D7)

Extend sticky header control:

```
[ Day ]  [ Swing ]  [ Position ]
```

- Each lane: independent `useSignalComposite(symbol, mode)` cache key includes `position`.
- State dot on tab when feed has a position card (optional — POS-D8).
- **Default tab:** the lane user clicked from feed; else last-used per symbol in sessionStorage.

### Position tab layout (information hierarchy)

1. **Glance strip** — symbol, Position verdict, direction confidence, price, `valid until` (90d)
2. **Investment Read** (AI Tier 2) — 2–3 sentences from `position_setup_read`; deterministic fallback; **pillar citations inline** (e.g. “F3 balance sheet: weak coverage”)
3. **Bull case / Bear case** (AI Tier 2) — two compact columns; each bullet tagged with pillar/layer ID; collapsible
4. **Fundamentals grid** — F1–F5 pillar cards (score bar, verdict chip, 1-line why, expand for chips + raw metrics)
5. **Structural technical** — weekly trend, 52w range position, RS vs SPY
6. **Decision + geometry** — entry zone, wide stop, T1/T2; **Geometry honesty** panel
7. **Evidence tabs** — Setup | Layers | Chart (2Y) | **Research** (SEC excerpts, cited news, macro)
8. **Ask the desk** — Assistant shortcut prefilled with Position context (“Explain the bear case for F4”)
9. **Footer disclaimer** — informational only; AI does not recommend allocation

### Investment home — `/dashboard/invest` (Journey A — primary)

**This is the investment product home**, not a secondary report. Layout (density-safe, ADR-003 compliant):

1. **Header** — “Long-horizon quality” + last scan time + symbol search (Journey B entry)
2. **Gem Candidates** — ranked table (default filter: tier = gem), columns: Symbol · Quality · Fundamentals · Trend · Sector · **Weakest pillar** · Why
3. **Expand filters** — pillar sliders (transparent), sector, market cap band
4. **Row click** → Deep Dive Position tab
5. **Empty state** — “No names passed gem gates this week — widen filters or run symbol lookup.”

Also surface **top 3 gem headlines** on Market Brief (collapsed tile, POS-D16) after validation soak — optional, not v1 blocker.

### Other discovery surfaces

| Surface | Phase | Description |
|---------|-------|-------------|
| **Universe scan job** | POS-D15 | Weekly batch + `GET /v1/signals/position/candidates` API |
| **Symbol lookup** | POS-D7 + POS-D4 | Search → Position deep dive; tier badge even off-list |
| **Investment screener** | POS-D13 | Same data as home; sharable filter URLs |
| **Watchlist quality badge** | POS-D14 | Gem/Strong dot on watchlist rail |
| **Portfolio context** | POS-AI-7 | Overlap vs gems in book (informational) |
| **Brief gem tile** | POS-D16 | Optional “3 gem candidates this week” on Market Brief |

**Do not** stack three full Decision blocks vertically by default — one active lane at a time.

---

## Implementation phases (strict order)

Each phase ships with **tests**, **BACKLOG row update**, and user **“go ahead”** before the next phase unless noted as doc-only.

| Phase | ID | Scope | Status |
|-------|-----|--------|--------|
| 0 | **POS-D0** | **This ADR** + BACKLOG section + cross-links (`SIGNAL_ENGINE.md` stub, `FUNDAMENTALS_CONTEXT_SPEC.md` Position note) | **DONE 2026-09-08** |
| 1 | **POS-D1** | **Data contracts** — `FundamentalsProvider` protocol; FMP endpoint map; Redis cache keys; peer set resolver; `docs/POSITION_FUNDAMENTALS_SPEC.md` (pillar formulas); mock fixtures | **DONE 2026-09-08** |
| 2 | **POS-D2** | **`position_fundamentals_analyzer.py`** — F1–F5 pillars, unit tests per pillar, golden symbols (AAPL, JPM, early-stage unprofitable name) | **DONE 2026-09-08** |
| 3 | **POS-D3** | **`position_technical_analyzer.py`** — weekly bar fetch (Polygon), SMA50/200, 52w range, RS 6M; pure tests | **DONE 2026-09-08** |
| 4 | **POS-D4** | **`position_composite_engine.py`** + **`POST /v1/signals/composite/position`** — mirror swing handler shape; `mode=position`, `signal_valid_days`, layer snapshots; API_CONTRACTS §4 | **DONE 2026-09-08** |
| 5 | **POS-D5** | **Position geometry** — `position_reference_stop_policy.py`, wider ATR k, structural stop from structure engine; T2 analyst PT band rules (B78 provenance); frontend mirror | **DONE 2026-09-08** |
| 6 | **POS-D6** | **Signal Math Contract** — extend `SIGNAL_LAYERS` / frontend mirror for `position` mode weights; `CompositeScoreEngine` mode=`position`; gate catalog doc | **DONE 2026-09-08** |
| 7 | **POS-D7** | **Deep Dive UI** — third lane; `useSignalComposite(..., 'position')`; BFF route; fundamentals grid component; Vitest + Playwright smoke | **DONE 2026-09-08** |
| 8 | **POS-D8** | **Trading Room gem rail (optional)** — compact “Gem candidates” strip linking to `/dashboard/invest`; **not** mixed into swing/day feed | Pending |
| 9 | **POS-D9** | **Ledger & validation** — `SignalRecord.mode` adds `position`; weekly capture job `ledger_capture_position`; shadow rows; `ledger_signal_report.py` position section; extend setup-evolution mode dimension | Pending |
| 10 | **POS-D10** | **Assistant & alerts** — `ASSISTANT_SYSTEM_PROMPT` three-desk rules; gem lookup intents; **no position emails** until VAL-POS soak sign-off | Pending |
| 11 | **POS-D11** | **Universe filters** — extend `swing_universe_filter` patterns for position (exclude leveraged/inverse ETFs, SPAC shells, <$500M avg dollar volume configurable) | Pending |
| 12 | **POS-D12** | **Counsel + copy review** — investment disclaimer strings; **“Gem candidate”** label review; AI thesis copy | Pending |
| 13 | **POS-D13** | **Investment home `/dashboard/invest`** — gem table + screener filters + symbol search; Journey A + B entry | Pending |
| 14 | **POS-D14** | **Watchlist investment quality** — Gem/Strong/Monitor tier dot on rail | Pending |
| 15 | **POS-D15** | **Position universe scan** — weekly batch, pre-filter, candidates API, cache snapshot | Pending |
| 16 | **POS-D16** | **Market Brief gem tile (optional)** — top 3 candidates after soak | Pending |
| **AI-1** | **POS-AI-1** | **`position_thesis_packet`** — pure builder from composite; bull/bear/open_questions with pillar refs; JSON schema + tests | Pending |
| **AI-2** | **POS-AI-2** | **`position_setup_read`** — extend `AIExplanationService` + `AiSetupRead` for Position tab; Redis cache | Pending |
| **AI-3** | **POS-AI-3** | **Assistant Position mode** — page context keys, prompt section, pillar-aware Q&A; Vitest contract tests | Pending |
| **AI-4** | **POS-AI-4** | **Research tab** — EDGAR 10-K excerpts + Perplexity industry context; citation UI; no score mutation | Pending |
| **AI-5** | **POS-AI-5** | **Sector pillar overrides** — banks/REIT/biotech analyzers + AI sector context lines | Pending |
| **AI-6** | **POS-AI-6** | **Investment compare** — 2–4 symbol pillar matrix (deterministic) + AI diff summary (no winner pick) | Pending |
| **AI-7** | **POS-AI-7** | **Portfolio-aware context** — broker holdings thematic overlap (informational); thesis drift when pillar degrades | Pending |

**Recommended PR slicing:** POS-D1+D2 → POS-D3+D4+D11 → POS-D5+D6 → POS-D7 (lookup) + POS-D15 (scan API stub) → POS-D13 (invest home) → POS-AI-1+2 → POS-D9 → full POS-D15 batch scale.

**Minimum lovable investment product (MLIP):** POS-D1–D7 + POS-D13 + POS-D15 (lite scan, ~500 names) — user can **see gems** and **look up any symbol** before ledger/alerts.

---

## Phase contracts (detail)

### POS-D0 contract

- ADR at `docs/adr/ADR-004-position-desk-long-term-investment.md`
- BACKLOG section **ADR-004** with phase table
- Note in `FUNDAMENTALS_CONTEXT_SPEC.md`: Position desk **exception** to “never scored” rule

### POS-D1 contract

- New module `stocvest/data/fundamentals_provider.py` with async methods:
  - `get_income_statements(symbol, period, limit)`
  - `get_balance_sheets(...)`, `get_cash_flows(...)`, `get_ratios(...)`, `get_key_metrics(...)`
  - `get_sector_peers(symbol) -> list[str]` (bounded N)
- FMP implementation + **`FundamentalsProviderMock`** for tests (no network in unit tests)
- Cache: Redis 24h statement snapshots; `get_settings().fmp_api_key` required for live scoring (graceful degrade → fundamentals layer `degraded`)
- Document rate limits and batch strategy (deep dive = 1 symbol, acceptable)

### POS-D2 contract

- `stocvest/signals/position_fundamentals_analyzer.py` returns `LayerResult`-compatible object
- Each pillar: pure functions under `stocvest/signals/position_fundamentals/` (mirror `indicators/` style)
- Tests: `tests/signals/position_fundamentals/` — min **40** unit tests across pillars + aggregate
- Value trap guard: negative earnings growth + low P/E → valuation pillar not bullish

### POS-D3 contract

- Polygon weekly bars: aggregate from daily or `timespan=week` if entitled
- Min **52 weekly bars** for full score; else `as_of_close` degraded technical
- Tests with fixture bars (no Polygon in unit tests)

### POS-D4 contract

- Handler: `stocvest/api/handlers/signals_composite_position.py` (or extend submodule)
- Response includes: `mode: "position"`, `signal_valid_days`, `signal_expires`, `position_fundamentals: { pillars: [...] }`, standard layer rows, `fundamental_context` (display parity with swing)
- BFF: `POST /api/stocvest/signals/composite/position`
- Tests: `tests/api/test_position_composite.py` (handler + insufficient data envelope)
- **Does not** modify swing/day handlers

### POS-D5 contract

- Stop: below structure engine support zone OR max(structure, entry − k×ATR_weekly) with k > swing default
- Min R/R to T1: **1.5** default (Secrets); swing 2.0 unchanged
- T2: min(next major resistance, analyst PT median if provenance clean, entry + β×ATR_weekly)
- Frontend: `position-reference-stop-resolve.ts` mirror
- Tests: fixtures on large-cap vs high-volatility names

### POS-D6 contract

- `signal_math_contract.py`: document third mode; optional `position_composite` weight validation
- `frontend/lib/signal-math/contract.ts` mirror
- `CompositeScoreEngine.resolve_weights(mode="position")`

### POS-D7 contract

- `DeepDiveLaneToggle`: third button; accent token (new `roleAccents.position` — e.g. amber/gold distinct from swing purple / day cyan)
- `useSignalComposite` type: `"day" | "swing" | "position"`
- New components: `position-fundamentals-grid.tsx`, `position-setup-read.tsx` (or extend `SignalsSetupRead` with mode prop)
- Tests: `deep-dive-position-lane.test.tsx`, cache key separation test

### POS-D8 contract

- **Optional** compact “Gem candidates” strip on Trading Room → links to `/dashboard/invest`
- **Off by default** (`STOCVEST_POSITION_FEED_ENABLED=0`) until POS-D9 soak
- **Never** mix position cards into swing/day feed cards
- No scanner column in v1

### POS-D9 contract

- Extend `SignalRecord.mode: Literal["day", "swing", "position"]`
- Migration: Dynamo existing rows unchanged
- EventBridge: `ledger_capture_position` — **Friday 4:10 PM ET** (weekly)
- Exit rules: structural break (weekly close below stop zone), validity expiry, manual close in admin tools
- `scripts/ledger_signal_report.py --mode position`
- **Wait 4–8 weeks** shadow soak before POS-D10 alerts

### POS-D10 contract

- Assistant: never compare “position is better than swing”
- Page context includes `position_verdict`, `position_fundamentals_summary` when Position tab active
- Alerts: **disabled** until user + counsel sign-off after POS-D9 soak

### POS-D11 contract

- Reuse inverse/leveraged ETF blocklist from GEO-2
- Add micro-cap / ADR liquidity gate (configurable)
- Document in SIGNAL_ENGINE.md § Position universe

### POS-D12 contract

- Copy review checklist: no “undervalued”, “strong buy”, “allocate”, “should own”
- **AI copy review:** bull/bear bullets must not imply action; counsel sign-off on Research tab
- UI disclaimer component reused on Position tab + any future position email

### POS-D13 contract

- Route: **`/dashboard/invest`** — primary **Journey A** surface (gem discovery home)
- Header symbol search → **Journey B** (lookup any ticker; navigates to Deep Dive Position tab)
- Presenter: `position-ranked-home-present.ts` (mirror `personal-ranked-home-present.ts`)
- Default view: **Gem Candidates** tier; columns: Symbol · Quality · Fundamentals · Trend · Sector · Weakest pillar · Why
- Row click → Deep Dive Position tab
- Data: **`GET /v1/signals/position/candidates`** (POS-D15); empty state when no names pass gates
- Screener: URL-query filters `?tier=gem&f3=min:70` — all filters documented in UI; sharable links
- Tests: presenter unit tests; no black-box single score without pillar expand

### POS-D14 contract

- Watchlist rail optional badge: Gem / Strong / Monitor tier when scan row or cached composite exists
- Tooltip: weakest pillar one-liner
- Off by default until POS-D13 ships

### POS-D15 contract

- Job: `position_universe_scan` — weekly (Sunday PM ET); v1 lite ~500 liquid US names (≥$2B cap, ≥$20M ADV)
- Cheap pre-filter (FMP ratios) before full composite to control cost
- Output: `PositionScanSnapshot` cache + **`GET /v1/signals/position/candidates?limit=50&tier=gem`**
- Gem gates G1–G9 applied in batch; rank via transparent `gem_rank` formula
- Stub API + small fixed universe acceptable for MLIP; scale batch after POS-D9

### POS-D16 contract

- Optional Market Brief collapsed tile: “3 gem candidates this week” → `/dashboard/invest`
- **After** POS-D9 validation soak; counsel sign-off on “gem” marketing copy (POS-D12)
- Not MLIP blocker

### POS-AI-1 contract

- `stocvest/signals/position_thesis_packet.py` — pure functions
- Input: position composite body + `position_fundamentals.pillars`
- Output schema documented in `docs/POSITION_AI_SPEC.md`:
  ```json
  {
    "bull_case": [{"text": "...", "source": "F2|F1|layer:sector", "confidence": "high|medium|low"}],
    "bear_case": [...],
    "open_questions": [...],
    "pillar_snapshot_hash": "..."
  }
  ```
- Tests: ≥15 cases including missing pillars, mixed backdrop, value trap

### POS-AI-2 contract

- Extend `POST /v1/signals/ai/explanations` with `type: "position_setup_read"`
- Request includes pillar summaries + thesis packet hash
- Response contract matches existing `{ text, source, cached, disclaimer }`
- Frontend: `PositionInvestmentRead` component; free users get deterministic brief from packet builder (no Claude)

### POS-AI-3 contract

- `buildSignalsPageAssistantContext` + `buildDashboardAssistantPageContext` include when Position tab active:
  - `trading_mode: "position"`
  - `position_verdict`, `position_pillars[]`, `weakest_pillar`, `thesis_packet_summary`, `gem_tier`
- **Gem discovery intents:** “what are today’s gems?”, “find strong long-term stocks” → read from `position/candidates` cache; list top N with pillar summary; **never** pick one as “best”
- New prompt section **POSITION DESK RULES** + **GEM DISCOVERY RULES** in `assistant_prompts.py`
- Tests: `trading-room-assistant-context.test.ts` + handler tests

### POS-AI-4 contract

- New BFF or extend composite handler: `position_research_bundle` (optional lazy load on Research tab)
- Sources: EDGAR 10-K item 1A risks (truncated), Perplexity “recent developments” with `web_sources[]`
- UI: `PositionResearchPanel` — citation chips, “External · not scored” badge
- Flag: `STOCVEST_POSITION_RESEARCH_ENABLED`; Perplexity budget cap per user/day

### POS-AI-5 contract

- Implement sector override tables in `position_fundamentals/sector_overrides.py`
- Tests per sector bucket (bank, REIT, biotech fixture)
- F7/F8 pillars optional behind `position_fundamentals_v2` flag

### POS-AI-6 contract

- Extend `assistant_multi_symbol_context` OR new `GET /v1/signals/position/compare?symbols=A,B,C`
- Deterministic pillar diff matrix in response; AI summary optional second call
- Assistant rule: present differences, **never** declare a winner

### POS-AI-7 contract

- When `GET /v1/portfolio/holdings` available: compute sector/theme weights
- Surface in Position context: “Your book is 28% semiconductors; this name adds overlap” — informational
- Thesis drift: weekly job compares current pillars to snapshot at watchlist add; alert **monitor** only after soak

---

## Validation loop (VAL-POS — after POS-D9)

Parallel to ADR-002 VAL-1:

1. Weekly `ledger_signal_report.py` position section
2. Manual review: 5 position deep dives / week — fundamentals grid vs external source (10-K, FMP UI)
3. Gate telemetry: which pillars bind most (`valuation`, `balance_sheet`, …)
4. **No alerts** until ≥4 weeks shadow rows and user sign-off

---

## What we explicitly do **not** do (v1)

- Replace swing as primary desk or merge swing + position verdicts
- Show a single blended “overall score” across three desks
- Portfolio optimization or “how much to invest”
- Auto-rebalance or model portfolio revival
- Score fundamentals on day desk
- Lower swing R/R or gates “because position exists”
- Ship position feed firehose on dashboard home (ADR-003 density rules)
- **Let AI set or override pillar scores, verdicts, or decision_state**
- **Ship a single opaque “AI investment score”** (competes with Danelfin on their terms — we win on transparency)
- **Present LLM research as scored layers**

---

## Success metrics (platform quality)

Track after POS-D9 + POS-D13 (not before):

| Metric | Target (initial) |
|--------|------------------|
| Gem candidates / weekly scan | 5–40 names (strict gates — empty week OK) |
| Pillar data quality ≥ medium | ≥85% of scan universe |
| Lookup (symbol → Position tab) p95 | <4s warm Lambda |
| User can name weakest pillar without AI | ≥70% in usability sessions |
| Gem list → Deep Dive conversion | Track; qualitative review |
| False “gem” post-hoc (ledger) | Review weekly after POS-D9 |

---

## Open questions (resolve in POS-D1 PR or user checkpoint)

| # | Question | Default if silent |
|---|----------|-------------------|
| 1 | UI label **Position** vs **Investment** | **Position** (API `position`) |
| 2 | FMP tier / budget for statement depth | Start with FMP stable endpoints; cache aggressively |
| 3 | Include REITs / banks with alternate pillar rules | Yes — sector-specific pillar overrides in POS-D2 |
| 4 | Position feed on dashboard | Off until POS-D9 soak |
| 5 | Dividend pillar in v1 or v1.1 | v1.1 (POS-D2 ships F1–F5 only) |
| 6 | Investment home route | `/dashboard/invest` (POS-D13) |
| 7 | AI bull/bear in v1 Position tab | **Yes** — POS-AI-1+2 bundled with POS-D7 |
| 8 | FMP vs Polygon fundamentals | **FMP primary**; Polygon for market bars only |

---

## References

- [`docs/FUNDAMENTALS_CONTEXT_SPEC.md`](../FUNDAMENTALS_CONTEXT_SPEC.md)
- [`docs/SIGNAL_ENGINE.md`](../SIGNAL_ENGINE.md)
- [`docs/VALIDATION_LOOP.md`](../VALIDATION_LOOP.md)
- [`docs/API_CONTRACTS.md`](../API_CONTRACTS.md) — AI explanations + assistant
- [`docs/adr/ADR-002-personal-swing-first-product-ops.md`](./ADR-002-personal-swing-first-product-ops.md)
- [`docs/adr/ADR-001-swing-polygon-primary-debenzinga.md`](./ADR-001-swing-polygon-primary-debenzinga.md)
- [`stocvest/signals/fundamental_context.py`](../../stocvest/signals/fundamental_context.py)
- [`stocvest/signals/assistant_prompts.py`](../../stocvest/signals/assistant_prompts.py)
- [`stocvest/data/fmp_client.py`](../../stocvest/data/fmp_client.py)
- [`frontend/components/dashboard/trading-room/deep-dive.tsx`](../../frontend/components/dashboard/trading-room/deep-dive.tsx)
- **Planned:** [`docs/POSITION_AI_SPEC.md`](../POSITION_AI_SPEC.md) (POS-AI-1)
- **Shipped:** [`docs/POSITION_FUNDAMENTALS_SPEC.md`](../POSITION_FUNDAMENTALS_SPEC.md) (POS-D1)

---

## Addendum — 2026-09-09 · Engine fidelity audit + AI-native roadmap

A layer-by-layer audit against the intended long-horizon roles (vs the reused six-layer
day/swing engine) surfaced two fidelity gaps and a set of high-leverage, **glass-box-preserving**
AI opportunities. The invariant stands: **AI narrates/researches/gates; deterministic pillars +
layers produce the score.** Nothing below turns the number into a black box.

### Fixed now
- **Market Internals is horizon-aware** — `InternalsAnalyzer(mode="position")` scores the
  structural VIX regime only; intraday breadth/participation and today's VIX move are excluded
  (were previously injecting daily tape noise into a multi-year verdict at 5% weight). Day/swing
  math is byte-identical (default `mode="day"`).

### Known soak-tuning item (do NOT invent constants pre-data)
- **News layer runs `mode="swing"`** inside `NewsAnalyzer` (position uses extended lookback +
  low 0.08 weight, but the recency/decay + analyst weighting are swing-tuned). A position recency
  profile (slower half-life, structural-catalyst emphasis) should be tuned **from the position
  ledger during the VAL-POS soak**, not hand-set. Tracked as **POS-AI-9** in BACKLOG.

### AI-native roadmap (post-soak, glass-box)
| ID | Idea | Why it wins | Guardrail |
|----|------|-------------|-----------|
| **POS-AI-8** | **Calibrated empirical probability** — surface `P(outperform over N months)` per tier from the ledger (hit-rate by score-bucket × regime, Wilson CIs) | Beats black-box "AI rating" apps with an *auditable* probability; the strongest "prediction" differentiator | Empirical from our own resolved signals only; shown with sample size + CI; never a model guess |
| **POS-AI-9** | Position-tuned News recency + turn ON Claude sentiment/impact for Position; embedding-based event dedup | Stops one story = five signals; sharper structural news read | Validate on ledger before flags flip; sentiment stays inside the deterministic News layer math |
| **POS-AI-10** | Deepen Research: RAG over full 10-K/10-Q + earnings-call transcripts; cross-check FMP fundamentals vs SEC **XBRL companyfacts** | Higher-fidelity, free primary-source fundamentals; richer (still `scored:false`) research | External content stays `scored:false`; XBRL only *flags* FMP disagreements, never silently overrides |
| **POS-AI-11** | Position-specific **walk-forward weight optimizer** once the ledger has depth | Learn the 7 weights from outcomes instead of hand-set defaults | Reuse D10 admin-proposal pipeline; human-approved, versioned |
| **POS-AI-12** | Stronger model tier (Sonnet/Opus) for the **Investment Read** only | Low call volume, high value → depth without day/swing budget blowup | Paid-gated; deterministic fallback + copy guard unchanged |

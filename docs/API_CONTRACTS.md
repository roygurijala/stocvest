# STOCVEST — API contracts (immutable sections)

**Last reviewed:** 2026-05-07

Sections referenced from **`docs/CONTEXT.md`** §7 must not change without explicit review and coordinated code updates.

---

## 1. BrokerAdapter (Python)

The broker layer exposes exactly **eight** async methods on `stocvest.brokers.adapter.BrokerAdapter`:

1. `connect(config: dict[str, Any]) -> None` — session setup; no secrets in logs.
2. `disconnect() -> None` — release connections and tasks.
3. `health_check() -> BrokerHealth` — cheap post-connect liveness.
4. `list_accounts() -> list[BrokerAccount]`
5. `get_positions(account_id: str) -> list[BrokerPosition]`
6. `place_order(account_id: str, request: PlaceOrderRequest) -> OrderAck`
7. `cancel_order(account_id: str, client_order_id: str) -> None`
8. `get_order(account_id: str, client_order_id: str) -> OrderStatus`

**Rule:** Adding or removing methods requires updating every adapter (`MockBrokerAdapter`, `IBKRBrokerAdapter`, `ETradeBrokerAdapter`) and downstream tests.

**DTOs:** `stocvest.brokers.models`  
**Exceptions:** `stocvest.brokers.exceptions`

---

## 4. HTTP API paths

All REST routes are versioned under `/v1/`.

### 4.1 Auth / health

- `GET /v1/health` — service liveness payload (`service`, `status`, `version`)
- `REQUEST_AUTHORIZER /v1/*` — Cognito JWT authorizer (allow/deny IAM policy)

### 4.2 Market data (Phase 4c)

- `GET /v1/market/status` — current market status (stocks/exchanges/currencies)
- `GET /v1/market/snapshot?symbol={ticker}` — point-in-time snapshot for one symbol
- `GET /v1/market/bars?symbol={ticker}&timeframe={tf}&limit={n}&from={yyyy-mm-dd}&to={yyyy-mm-dd}`
- `GET /v1/market/news` — shape depends on **`symbol`**:
  - **Without `symbol`:** query **`limit`** (1–1000, default **20**). JSON **`{ "headlines": [ ... ] }`** (not a bare array). Authenticated users merge default-watchlist tickers into the Polygon query with a fixed liquid-ticker set (cap **30** merged symbols). Server fetches up to **50** Polygon rows (**4h** `published_utc_gte`, **24h** widen once if empty), scores and dedupes, returns at most **`min(limit, 20)`** headlines. Each headline includes at least: **`id`**, **`title`**, **`published_utc`**, **`publisher`** (`name`, **`tier`**), **`tickers`**, **`article_url`**, **`sentiment`**, **`affected_stocks`**, **`impact_summary`**, **`relevance_score`** (0–100), **`category`** (`earnings` \| `analyst` \| `macro` \| `sector` \| `merger` \| `breaking` \| `general`), **`catalyst_category`** (legacy buckets incl. `ma` / `fda`), **`credibility`** (`label`, `band`), **`matches_watchlist`**, plus back-compat **`article_id`**, **`published_at`**, **`url`**, **`source`**, optional **`description`**, **`image_url`**.
  - **With `symbol`:** query **`days`** (1–20, default **20**), **`limit`** (1–100, default **20**), optional **`recent_hours`** (1–168, default **8**) — defines the “recent” window for **`has_recent_news`** / **`is_recent`** vs archive labeling. JSON **`{ "symbol", "has_recent_news", "recent_cutoff_hours", "articles", "total_found", "oldest_included" }`** (`recent_cutoff_hours` echoes the applied window). **`articles`** items are panel-oriented: **`id`**, **`title`**, **`source`**, **`source_label`**, **`published_at`**, **`sentiment_score`**, **`sentiment_label`**, **`catalyst_type`**, **`url`**, **`is_recent`**, **`age_label`**.
- `GET /v1/market/options?symbol={ticker}&limit={n}[&expiration={yyyy-mm-dd}&option_type={call|put}&strike_gte={x}&strike_lte={y}]`

`timeframe` values are fixed to `Timeframe` enum values:
`1min`, `5min`, `15min`, `30min`, `1hour`, `4hour`, `1day`, `1week`.

### 4.3 Signals (Phase 4d)

- `POST /v1/signals/composite/real` — JSON body `{ "symbol": "AAPL" }`; server runs six analyzers on **intraday** data; success payload includes **`mode": "day"`**, **`signal_valid_until`** (next US RTH close, ISO UTC), plus composite fields (`layers`, `score`, …). **`insufficient_data`** still HTTP 200 with `market_status`.
- `POST /v1/signals/composite/swing` — same body; **daily** bars + swing parameters (extended news/macro/geo, optional weekly sector rel. strength); success includes **`mode": "swing"`**, **`signal_valid_days`**, **`signal_expires`** (ISO UTC).
- `POST /v1/signals/swing/composite` — build structured composite score and signal parameters from layer signals
- `POST /v1/signals/swing/synthesis/parse` — parse AI JSON synthesis output to normalized action payload
- `POST /v1/signals/day/setups` — rank intraday setup candidates from 1-minute bars
- `POST /v1/signals/swing/setups` — rank swing candidates from **daily** (`1day`) bars; body mirrors day/setups (`bars_by_symbol`, `liquidity_by_symbol`, `snapshots_by_symbol`, `regime`, optional `geo_scan_articles`) plus optional **`min_daily_bars`** (default **205** for EMA200 context). Response rows include the usual confluence fields plus **`scanner_mode": "swing_daily"`**, **`ema_daily_crossovers`**, **`weekly_rsi_recovery`**, **`weekly_rsi`**, **`volume_expansion_ratio`**, **`pattern_maturity_days`**
- `POST /v1/signals/day/briefing` — render daily briefing markdown from structured inputs
- `GET /v1/signals/recent` — public historical signal data (last 50 platform rows); optional `?landing=true`
- `GET /v1/signals/performance/summary` — directional accuracy over evaluated platform signals (1d horizon); JSON uses `correct_direction_count`, `incorrect_direction_count`, `neutral_direction_count` (legacy `win_count` / `loss_count` accepted on read in clients only)
- `GET /v1/signals/records/{signal_id}` — single **platform** signal (404 if row is user-scoped)
- `GET /v1/signals/me/history` — authenticated user’s evaluated signals. Query: `symbol`, `days` (1–365), optional `mode` (`day` \| `swing`), optional **`page_size`** (**25** \| **50** \| **75** \| **100**, default **25**), optional **`cursor`** (opaque token from prior response’s **`next_cursor`**), optional **`ledger_only`** (`true` to return only **`ledger_qualified`** rows for the validation ledger). Legacy **`limit`**: if **`page_size`** is omitted, **`limit`** may be used; values in **25/50/75/100** map to **`page_size`**; other values clamp to **100** or **25** as implemented. Response body: **`{ "items": [ ... ], "next_cursor": string | null, "page_size": number }`**. Each row includes core D1 fields plus optional ledger keys when present: `ledger_qualified`, `closed_at`, `ledger_entry_date_et`, `ledger_exit_date_et`, `entry_rationale`, `exit_reason`, `decision_state_entry`, `decision_state_exit`, `market_regime_exit`, `gate_status` (object, parsed from `gate_status_json`), `setup_type`, `exit_rule`, `max_adverse_excursion_pct`, `max_favorable_excursion_pct`, `hold_duration_minutes`, `layer_scores`, `mode`, `status`.
- `GET /v1/signals/me/records/{signal_id}` — single signal for the signed-in user only
- `GET /v1/signals/founding-members` — **public**. JSON **`founding_member_count`** (**int**, Dynamo scan of **`Users.subscriptionPlan`** for paid tiers only: **`swing_pro`**, **`swing_day_pro`**, legacy **`founding_swing_pro`**, **`founding_swing_day_pro`**), **`founding_spots_total`** (**100**), **`founding_spots_remaining`** (non-negative clamp of **100 − count**). Never counts **`free`** or unknown plans.

### 4.4 Brokers (Phase 4e)

- `GET /v1/brokers/health?broker={mock|ibkr|etrade}[&account_id={id}]`
- `GET /v1/brokers/accounts?broker={mock|ibkr|etrade}`
- `GET /v1/brokers/positions?broker={mock|ibkr|etrade}&account_id={id}`
- `GET /v1/brokers/overview?broker={mock|ibkr|etrade}` — returns health + accounts + positions_by_account in one broker session
- `POST /v1/brokers/orders?broker={mock|ibkr|etrade}&account_id={id}`
- `GET /v1/brokers/orders?broker={mock|ibkr|etrade}&account_id={id}&client_order_id={id}`
- `DELETE /v1/brokers/orders?broker={mock|ibkr|etrade}&account_id={id}&client_order_id={id}`

### 4.5 Portfolio (Phase 4f)

- `POST /v1/portfolio/holdings?broker={mock|ibkr|etrade}&account_id={id}`
- `POST /v1/portfolio/summary?broker={mock|ibkr|etrade}&account_id={id}`
- `POST /v1/portfolio/allocation?broker={mock|ibkr|etrade}&account_id={id}`

Each portfolio endpoint accepts optional body input:
- `prices`: `{ "SYMBOL": markPrice }` map for market-value/exposure calculations
- `connect_config`: broker adapter connect payload forwarded to `connect()`

### 4.6 WebSocket (Phase 4g)

WebSocket routes are served under API Gateway WebSocket integration:

- `$connect` → `websocket_connect_handler`
- `$disconnect` → `websocket_disconnect_handler`
- `$default` → `websocket_default_handler`

Supported default actions:
- `ping`
- `subscribe` (requires `channel`)
- `unsubscribe` (requires `channel`)
- `list_subscriptions`

### 4.7 Scanner endpoints (Phase 4h)

- `POST /v1/scanner/gaps` — run pre-market gap scan from snapshot payloads
- `POST /v1/scanner/catalysts` — rank news catalysts from scored article payloads
- `POST /v1/scanner/intraday` — run intraday setup scan from 1-minute bar payloads
- `POST /v1/scanner/briefing` — generate daily scanner briefing markdown

### 4.8 Journal endpoints (Phase 5 support)

- `GET /v1/journal/entries` — list trade-journal entries for authenticated user
- `POST /v1/journal/entries` — create a new open trade-journal entry for authenticated user

### 4.9 PDT endpoint (Phase 5 support)

- `GET /v1/pdt/status` — returns authenticated user's PDT assessment snapshot
  - Includes `current_day_trade_count` and `days_until_reset`
  - Supports optional `as_of=YYYY-MM-DD` query for deterministic assessments/testing

### 4.10 User profile (brokers Lambda)

Authenticated:

- `GET /v1/users/me` — returns **`UserProfile`** JSON: **`user_id`**, **`trading_mode`**, onboarding/legal fields, **`subscription_plan`** (billing; not client-writable here), **`beta_full_access`**, **`beta_access_until`**, **`beta_access_granted_at`**, derived **`has_full_access`** (**true** when paid **`subscription_plan`** or **active** beta window), **`has_ai_explanations`** (mirrors **`has_full_access`** for gating Claude explanations).

- `PATCH /v1/users/me` — updates onboarding/legal/trading-mode fields **only**. Body keys **`subscription_plan`**, **`beta_full_access`**, **`beta_access_until`**, **`beta_access_granted_at`** are **stripped** (billing + admin concern).

Admin (same authorization mode as **`GET /v1/signals/analysis`** — internal analysis header **`X-Stocvest-Internal-Analysis`**, JWT **`sub` ∈ `STOCVEST_ANALYSIS_ADMIN_SUBS`**, or Cognito group **`signal-analytics-admin`**):

- `PATCH /v1/admin/users/{user_id}/beta-access` — JSON **`{ "enabled": true|false [, "until": "<ISO-8601 optional>"] }`**. Sets beta fields on the **`Users`** row; responses match **`GET /v1/users/me`** shape when possible. Writes an **`AuditEvent`** row when Dynamo audit is configured.

- `GET /v1/admin/audit/users/{user_id}` — newest-first audit items for **`user_id`**; optional query **`limit`** (1–500, default **200**). Each item aligns with **`AuditEvent`** (**`route`**, **`method`**, **`statusCode`**, redacted **`requestSummary`** / **`responseSummary`**, optional **`marketSnapshot`**, entitlement/pricing snapshots).

- `GET /v1/admin/audit/sessions/{session_id}` — same item shape filtered by **`sessionId`** (**best-effort `Scan`** in Dynamo implementation; callers should keep **`limit`** reasonable).

### 4.11 HTTP audit + correlation headers

- After each HTTP Lambda response routed through **`stocvest.api.lambda_dispatch`** (excluding **`authorizer`** / non-HTTP events), the runtime **best-effort** persists an **`AuditEvent`** when **`DYNAMODB_AUDIT_EVENTS_TABLE`** is set.

- Browsers integrating the SPA against API Gateway should send **`x-stocvest-session-id`** on mutating reads when convenient; it is echoed into audit rows (**`sessionId`**) for **`GET .../audit/sessions/...`** replay. Listed on API Gateway **CORS** **`allow_headers`** and on Lambda **`Access-Control-Allow-Headers`** for credentialed responses.

Terraform table **`AuditEvents`**: **`pk`** = `user#{userId|anon}`, **`sk`** = `{occurred_at ISO}#{event_id}` (**`audit_store.py`**).

### 4.12 Beta access script

- Repo script **`scripts/beta_access.py`** — operator CLI: updates **`Users`** Dynamo attributes **`betaFullAccess`**, **`betaAccessUntil`**, **`betaAccessGrantedAt`** (requires **`DYNAMODB_USERS_TABLE`** + AWS creds). Mirrors **`PATCH .../beta-access`** semantics (**`--enable` / `--disable`**, optional **`--until`**).

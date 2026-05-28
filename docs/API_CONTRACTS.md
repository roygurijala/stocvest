# STOCVEST — API contracts (immutable sections)

**Last reviewed:** 2026-05-15

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
- `GET /v1/market/snapshots?symbols={comma-separated}` — **authenticated** batch snapshots for dashboard lists; JSON **`{ "snapshots": [ … ] }`** (each item uses the same field shape as the single-symbol snapshot, e.g. **`symbol`**, **`last_trade_price`**, **`day_close`**, **`company_name`**, **`change_percent`**). **Next.js BFF:** **`GET /api/stocvest/market/snapshots?symbols=…`** (`frontend/app/api/stocvest/market/snapshots/route.ts`) proxies this for Client Components (session cookie); omitting or blank **`symbols`** returns **`{ "snapshots": [] }`** with HTTP 200.
- `GET /v1/market/bars?symbol={ticker}&timeframe={tf}&limit={n}&from={yyyy-mm-dd}&to={yyyy-mm-dd}`
- `GET /v1/market/news` — shape depends on **`symbol`**:
  - **Without `symbol`:** query **`limit`** (1–1000, default **20**). JSON **`{ "headlines": [ ... ] }`** (not a bare array). Authenticated users merge default-watchlist tickers into the Polygon query with a fixed liquid-ticker set (cap **30** merged symbols). Server fetches up to **50** Polygon rows (**4h** `published_utc_gte`, **24h** widen once if empty), scores and dedupes, returns at most **`min(limit, 20)`** headlines. Each headline includes at least: **`id`**, **`title`**, **`published_utc`**, **`publisher`** (`name`, **`tier`**), **`tickers`**, **`article_url`**, **`sentiment`**, **`affected_stocks`**, **`impact_summary`**, **`relevance_score`** (0–100), **`category`** (`earnings` \| `analyst` \| `macro` \| `sector` \| `merger` \| `breaking` \| `general`), **`catalyst_category`** (legacy buckets incl. `ma` / `fda`), **`credibility`** (`label`, `band`), **`matches_watchlist`**, plus back-compat **`article_id`**, **`published_at`**, **`url`**, **`source`**, optional **`description`**, **`image_url`**.
  - **With `symbol`:** query **`days`** (1–20, default **20**), **`limit`** (1–100, default **20**), optional **`recent_hours`** (1–168, default **8**) — defines the “recent” window for **`has_recent_news`** / **`is_recent`** vs archive labeling. JSON **`{ "symbol", "has_recent_news", "recent_cutoff_hours", "articles", "total_found", "oldest_included" }`** (`recent_cutoff_hours` echoes the applied window). **`articles`** items are panel-oriented: **`id`**, **`title`**, **`source`**, **`source_label`**, **`published_at`**, **`sentiment_score`**, **`sentiment_label`**, **`catalyst_type`**, **`url`**, **`is_recent`**, **`age_label`**.
- `GET /v1/market/options?symbol={ticker}&limit={n}[&expiration={yyyy-mm-dd}&option_type={call|put}&strike_gte={x}&strike_lte={y}]`

`timeframe` values are fixed to `Timeframe` enum values:
`1min`, `5min`, `15min`, `30min`, `1hour`, `4hour`, `1day`, `1week`.

### 4.2.1 Opportunity Desk (D13)

- `GET /v1/desk/today` — **authenticated**. Query **`mode`** = `swing` \| `day` (default `swing`). Reads Upstash **`stocvest:dashboard:opportunity_desk_{swing|day}`** populated by EventBridge scanner jobs **`opportunity_desk`** (full) and **`opportunity_desk_movers`** (math-only refresh). Response: `{ mode, source: "cache" | "cache_miss", envelope, data, disclaimer }`. **`data`** when present includes **`discovery`** (leader rows), **`movers_radar`**, **`recently_hot`**, **`quiet_leaders`** (swing only — low-velocity names with strong daily structure; empty on day cache), **`scanned_snapshot_count`**, **`eligible_symbol_count`**, **`generated_at`**, **`snapshot_source`**, **`tier`**. Each **`quiet_leaders`** row mirrors discovery shape plus **`technical_score`**, **`daily_rsi`**, **`why_line`**, **`quiet_leader`: true**. Populated on **`opportunity_desk`** full batch only (`stocvest/api/services/opportunity_desk/quiet_leaders.py`). **BFF:** `GET /api/stocvest/desk/today?mode=…`.
- `POST /v1/desk/refresh` — **authenticated** (scanner Lambda, 120s). Manual Tier B (`movers`) then Tier C (`full`) batch. Per-user **5 min** cooldown via Upstash `stocvest:desk:refresh_cooldown:{sub}`; **429** with **`retry_after_seconds`** when limited. Success: `{ status: "ok", tiers: ["movers","full"], movers, full, disclaimer }`. **BFF:** `POST /api/stocvest/desk/refresh` (`maxDuration` 120).

### 4.3 Signals (Phase 4d)

- `POST /v1/signals/composite/real` — JSON body `{ "symbol": "AAPL" }`; server runs six analyzers on **intraday** data; success payload includes **`mode": "day"`**, **`signal_valid_until`** (next US RTH close, ISO UTC), plus composite fields (`layers`, `score`, …). When alignment data is available, may also include informational **`weekly_timeframe`**, **`timeframe_alignment`** (intraday vs weekly context; does not change actionable gates), **`causal_narrative`** (headwind chain object: **`summary`**, **`chain[]`**, **`layer_notes`**, **`setup_bias`** — display-only), and **`execution_quality`** (soft execution context: **`band`**, **`stop_atr_ratio`**, **`level_path`**, **`volume_band`**, **`session_window`**, **`setup_tags`**, **`disclaimer`** — informational only; does not change actionable gates). On scheduled **ledger capture**, response may include **`ledger_qualified`** (bool) and **`gate_status`** (object) when the caller is authenticated. **`insufficient_data`** still HTTP 200 with `market_status`.
- `POST /v1/signals/composite/swing` — same body; **daily** bars + swing parameters (extended news/macro/geo, optional weekly sector rel. strength); success includes **`mode": "swing"`**, **`signal_valid_days`**, **`signal_expires`** (ISO UTC). May include **`weekly_timeframe`**, **`timeframe_alignment`**, **`causal_narrative`**, and **`execution_quality`** (same informational contract as day composite). May include **`ledger_qualified`** / **`gate_status`** when written during ledger capture.

**Composite `layers[]` — sector row (additive, backward compatible):** When the **`layer`** value is **`sector`**, the object may include optional **`sic_mapping_tier`** — one of **`exact`**, **`prefix`**, **`coarse`**, **`fallback_spy`** — describing how Polygon **`sic_code`** was mapped to the internal sector bucket (see **`docs/SIGNAL_ENGINE.md`** § Sector). The field is **omitted** while sector cache is **`pending_cache_refresh`** or when tier is unknown. ETF choice and scores are unchanged from pre-tier behavior; this is metadata for debugging, analytics, and future UI.
- `POST /v1/signals/swing/composite` — build structured composite score and signal parameters from layer signals
- `POST /v1/signals/swing/synthesis/parse` — parse AI JSON synthesis output to normalized action payload
- `POST /v1/signals/day/setups` — rank intraday setup candidates from 1-minute bars. Default response: **array** of qualifying rows. Optional v2 bundle: set **`include_near_qualification": true`** with **`near_min_score`** (default **0.35**) and **`near_limit`** (default **5**) → **`{ "qualifying": [...], "near_qualification": [...] }`**. Near rows include **`qualification_tier": "near"`** and **`alignment`** (`aligned` / `total` / `label` from trigger count). Optional **`include_evaluation_trace": true`** with **`evaluation_trace_limit`** (default **20**, max **50**) adds **`evaluation_trace`**: per-symbol rows with **`gate`**, **`detail`**, **`outcome": "did_not_qualify"`** (symbols already qualifying or near-qualification are excluded). Legacy clients omit the flags and still receive an array.
- `POST /v1/signals/swing/setups` — rank swing candidates from **daily** (`1day`) bars; body mirrors day/setups (`bars_by_symbol`, `liquidity_by_symbol`, `snapshots_by_symbol`, `regime`, optional `geo_scan_articles`) plus optional **`min_daily_bars`** (default **205** for EMA200 context). Same optional v2 bundle as day/setups (`include_near_qualification`, default **`near_min_score` 0.28**; optional **`include_evaluation_trace`**). When trace is requested and the caller is authenticated, rows are also **persisted** (48h TTL per user × desk × ET session date). Response rows include the usual confluence fields plus **`scanner_mode": "swing_daily"`**, **`ema_daily_crossovers`**, **`weekly_rsi_recovery`**, **`weekly_rsi`**, **`volume_expansion_ratio`**, **`pattern_maturity_days`**
- `GET /v1/signals/scanner-trace` — **auth required**. Returns persisted **`evaluation_trace`** for the signed-in user. Query: **`mode`** = `day` | `swing` | `both` (default `both`), optional **`session_date`** (ET `YYYY-MM-DD`, default today), **`limit`** (default **20**, max **50**). Response: `{ session_date_et, mode, evaluation_trace, disclaimer }`. DynamoDB table **`ScannerEvaluationTrace`** (`userId` + `sk` = `trace#{desk}#{session_date}`); **terraform apply** required for the route + table.
- `POST /v1/signals/day/briefing` — render daily briefing markdown from structured inputs
- `GET /v1/signals/recent` — public historical signal data (last 50 platform rows); optional `?landing=true`
- `GET /v1/signals/performance/summary` — directional accuracy over evaluated platform signals (1d horizon); JSON uses `correct_direction_count`, `incorrect_direction_count`, `neutral_direction_count` (legacy `win_count` / `loss_count` accepted on read in clients only)
- `GET /v1/signals/gap-intel` — **authenticated**. Query **`symbol`** (required), **`trading_mode`** (`day` \| `swing`, default **`day`**). Server fetches Polygon snapshot, same-session **1min** aggregates, optional prior-session daily bar, and optional market-status; returns a deterministic **Gap Intelligence** JSON object (`phase`, `gap`, `levels`, `liquidity`, `scenario_builder`, `flags`, `session_date`, `computed_at_utc`) plus **`disclaimer`**. Clients may forward a whitelisted subset as **`page_context.gap_intel`** to **`POST /v1/signals/assistant/chat`** (see serializer in `stocvest.signals.assistant_prompts.serialize_page_context`).
- `POST /v1/signals/gap-intel/batch` — **authenticated**. JSON body **`symbols`** (non-empty string array, max **24**), **`trading_mode`** (`day` \| `swing`). Returns **`items`** (map symbol → same snapshot shape as GET), **`errors`** (map symbol → message for per-symbol failures), and **`disclaimer`**. When **`DYNAMODB_GAP_INTEL_CACHE_TABLE`** is set, GET and batch may return cached rows keyed by symbol × mode × ET session date (soft TTL ~120s).
- `GET /v1/signals/records/{signal_id}` — single **platform** signal (404 if row is user-scoped)
- `GET /v1/signals/me/history` — **deprecated (B46)** — legacy **SignalHistory** ledger. Prefer **`GET /v1/analytics/setup-outcomes`** for user setup behavior. Response includes **`Deprecation: true`** and **`Link: </v1/analytics/setup-outcomes>; rel="successor-version"`**. Authenticated user’s evaluated signals. Query: `symbol`, `days` (1–365), optional `mode` (`day` \| `swing`), optional **`page_size`** (**25** \| **50** \| **75** \| **100**, default **25**), optional **`cursor`** (opaque token from prior response’s **`next_cursor`**), optional **`ledger_only`** (`true` to return only **`ledger_qualified`** rows for the validation ledger; default **`true`** in practice — set **`ledger_only=false`** for study analysis including **shadow** rows with pattern **`*:ledger_capture_shadow`**). Legacy **`limit`**: if **`page_size`** is omitted, **`limit`** may be used; values in **25/50/75/100** map to **`page_size`**; other values clamp to **100** or **25** as implemented. Response body: **`{ "items": [ ... ], "next_cursor": string | null, "page_size": number }`**. Each row includes core D1 fields plus optional ledger keys when present: `ledger_qualified`, `closed_at`, `ledger_entry_date_et`, `ledger_exit_date_et`, `entry_rationale`, `exit_reason`, `decision_state_entry`, `decision_state_exit`, `market_regime_exit`, `gate_status` (object, parsed from `gate_status_json` — may include nested **`gates`**, **`execution_quality`**, **`evaluation_source`**: `ledger_capture` \| `on_demand`), `setup_type`, `exit_rule`, `max_adverse_excursion_pct`, `max_favorable_excursion_pct`, `hold_duration_minutes`, `layer_scores`, `mode`, `status`.
- `GET /v1/signals/me/records/{signal_id}` — single signal for the signed-in user only
- `GET /v1/signals/founding-members` — **public**. JSON **`founding_member_count`** (**int**, Dynamo scan of **`Users.subscriptionPlan`** for paid tiers only: **`swing_pro`**, **`swing_day_pro`**, legacy **`founding_swing_pro`**, **`founding_swing_day_pro`**), **`founding_spots_total`** (**100**), **`founding_spots_remaining`** (non-negative clamp of **100 − count**). Never counts **`free`** or unknown plans.
- `POST /v1/signals/assistant/chat` — **authenticated**. STOCVEST Assistant conversational explanations for signed-in users. **Caller surface:** the BFF route at `app/api/stocvest/signals/assistant/chat/route.ts` proxies this; the only client-side caller is `components/assistant/stocvest-assistant.tsx` when its server-rendered `isAuthenticated` prop is `true`. The assistant is now mounted in `app/layout.tsx` for **every** visitor (logged-in and anonymous) — anonymous traffic uses the new `POST /v1/public/assistant/chat` route below instead, so this authenticated endpoint is only invoked when there's a session cookie to ride. Logged-in users get the assistant on every route; **every dashboard page** publishes a whitelisted `page_context` via `usePublishAssistantContext`, and unknown keys are silently dropped server-side regardless. Request body: 
  ```jsonc
  {
    "messages": [
      { "role": "user" | "assistant", "content": "string" }
      // server-side sanitize_messages DROPS any other role (e.g. client-injected "system");
      // history is trimmed to the last 12 user/assistant turns; individual user content is
      // capped at 2000 chars.
    ],
    "page_context": {
      // ALL fields optional; only the whitelisted keys below survive on the server.
      "page": "signals/layers" | "signals/history" | "dashboard/scanner" | string,
      "trading_mode": "swing" | "day",
      "symbol": "AAPL",
      "analysis_status": "loaded" | "loading" | "unavailable" | "insufficient_data",
      "decision_state": "actionable" | "monitor" | "blocked",
      "decision_line": "Decision: ⚠️ Monitor only ...",
      "decision_rationale": { "category": "risk_reward" | "confirmation" | "regime" | "data_insufficient" | "readiness", "label": "Why hold:", "text": "..." },
      "trade_readiness": 88,
      "risk_reward": 0.5,
      "trend_strength": "Strong",
      "trend_direction": "Long",
      "market_regime": "Neutral",
      "layer_alignment_pct": 88,
      "layer_status": { "technical": "Bullish", "news": "Neutral", "macro": "Neutral", "sector": "Bullish", "geopolitical": "Neutral", "internals": "Bullish" },

      // ----- Scanner-overview fields (multi-symbol summary page). Set only when page = "dashboard/scanner". -----
      "scanner_focus": "swing" | "day" | "both",
      "market_open": true,
      "gap_with_catalyst_count": 3,
      "gap_without_catalyst_count": 1,
      "ranked_setups_count": 0,
      "swing_setups_suppressed": true,
      "setups_empty_message": "No swing setups — regime and structure not aligned.",
      "top_setups": [
        // capped at 3 items; bucketed strength, no raw scores
        { "symbol": "TSLA", "direction": "long" | "short", "strength_bucket": "strong" | "moderate" | "weak", "confluence": true, "orb_expired": false }
      ],
      "top_gaps_with_catalyst": [
        // capped at 3 items; bucketed quality, no raw scores
        { "symbol": "NVDA", "gap_direction": "up" | "down", "quality_bucket": "high" | "medium" | "low", "catalyst_category": "earnings", "catalyst_sentiment": "bullish" | "bearish" | "neutral" }
      ]
    }
  }
  ```
  Response: `{ "text": string, "source": "ai" | "deterministic", "mode": "general" | "contextual", "upgrade_available": boolean, "disclaimer": string }`. **Mode** is `contextual` when `page_context` carries any of `page`, `symbol`, or a recognized `decision_state`; else `general`. This is intentional so multi-symbol overview pages like the scanner (which have no single symbol or decision_state) still drive the LLM's scanner-aware rule with the page identifier plus summary fields. **Source** is `ai` only for paid users (`has_ai_explanations`) when Anthropic responds successfully; otherwise `deterministic` (free user upgrade copy, or a calm fallback line on Claude outage). **Contract guarantee:** the server-held system prompt is the locked STOCVEST Assistant prompt (no investment advice, no price predictions, no exposure of internal weights/thresholds); clients **cannot** override it. Unknown keys inside `page_context` are silently dropped; non-`user`/`assistant` roles in `messages` are silently dropped. `top_setups` and `top_gaps_with_catalyst` are capped at 3 entries each server-side, with invalid `direction` / `strength_bucket` / `gap_direction` / `quality_bucket` values dropped silently so the assistant never receives free-form strings from the client.

- `POST /v1/public/assistant/chat` — **unauthenticated** (no JWT authorizer). STOCVEST Assistant for the marketing surface — anonymous visitors on `/`, `/login`, `/signup`, etc. can chat. **Caller surface:** the BFF route at `app/api/stocvest/public/assistant/chat/route.ts` proxies this; the only client-side caller is `components/assistant/stocvest-assistant.tsx` when its server-rendered `isAuthenticated` prop is `false`. Request body:
  ```jsonc
  {
    "messages": [{ "role": "user" | "assistant", "content": string }]
  }
  ```
  Any `page_context` posted by a tampered client is **ignored** server-side (`public_assistant_chat_handler` never forwards it to the service, and `AssistantChatService.reply_public` does not accept the kwarg by signature). Response: same shape as the authenticated route — `{ "text": string, "source": "ai" | "deterministic", "mode": "general", "upgrade_available": boolean, "disclaimer": string }`. **Mode** is always `general` on this route (anonymous visitors have no STOCVEST page state); `upgrade_available` is always `true` (the response includes an implicit invitation to sign up). **Contract guarantee:** the server holds the same locked STOCVEST Assistant prompt as the authenticated route, with the **PUBLIC MODE** section activated via the appended `session_mode=public` marker. The LLM is permitted to explain what STOCVEST is, position it versus signal-alert services in factual qualitative terms, and define general finance / trading terminology (EMA, RSI, MACD, VWAP, ORB, R/R, expectancy, drawdown, etc.). It continues to refuse all trade recommendations, price predictions, and claims about STOCVEST's accuracy / profitability. When the LLM is unreachable the route returns a calm deterministic intro line so the homepage chat never appears broken. There is no `has_ai_explanations` gate on this path — the marketing experience must be useful to anonymous visitors — but the same global Claude rate limiter that throttles authenticated paid traffic also throttles this route, capping abuse cost.

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

- `GET /v1/users/me` — returns **`UserProfile`** JSON: **`user_id`**, **`trading_mode`**, onboarding/legal fields, **`subscription_plan`** (billing; not client-writable here), **`last_active_at`** (optional ISO timestamp; throttled server-side touch so admins can see recent app opens), **`beta_full_access`**, **`beta_access_until`**, **`beta_access_granted_at`**, derived **`has_full_access`** (**true** when paid **`subscription_plan`** or **active** beta window), **`has_ai_explanations`** (mirrors **`has_full_access`** for gating Claude explanations).

- `PATCH /v1/users/me` — updates onboarding/legal/trading-mode fields **only**. Body keys **`subscription_plan`**, **`beta_full_access`**, **`beta_access_until`**, **`beta_access_granted_at`** are **stripped** (billing + admin concern).

Admin (same authorization mode as **`GET /v1/signals/analysis`** — internal analysis header **`X-Stocvest-Internal-Analysis`**, JWT **`sub` ∈ `STOCVEST_ANALYSIS_ADMIN_SUBS`**, or Cognito group **`signal-analytics-admin`**):

- `PATCH /v1/admin/users/{user_id}/beta-access` — JSON **`{ "enabled": true|false [, "until": "<ISO-8601 optional>" | "indefinite": true] }`**. Sets beta fields on the **`Users`** row; responses match **`GET /v1/users/me`** shape when possible. When **`enabled`** is **true**: if **`indefinite`** (or **`no_expiry`**) is **true**, no end date is stored (open-ended beta). Else if **`until`** is omitted, **`beta_access_until`** defaults to **21 days** from grant time (UTC). Do not send both **`until`** and **`indefinite`**. Writes an **`AuditEvent`** row when Dynamo audit is configured.

- `GET /v1/admin/audit/users/{user_id}` — newest-first audit items for **`user_id`**; optional query **`limit`** (1–500, default **200**). Each item aligns with **`AuditEvent`** (**`route`**, **`method`**, **`statusCode`**, redacted **`requestSummary`** / **`responseSummary`**, optional **`marketSnapshot`**, entitlement/pricing snapshots).

- `GET /v1/admin/users/{user_id}/activity-errors` — admin-only; Cognito user must exist (same **`analysis_authorized()`** gate as other admin user routes). Optional query **`days`** (1–30, default **7**) defines a rolling UTC window. Reads up to **1000** newest partition rows for that user from the audit store and returns **`items`** where **`occurred_at` ≥ cutoff** and the row is error-like: HTTP **`status_code` ≥ 400** and/or **`outcome`** ∈ {**`error`**, **`failure`**}. Response JSON: **`user_id`**, **`days`**, **`cutoff_utc`**, **`items`** (each object matches **`AuditEvent`** **`model_dump`** / snake_case fields as other audit feeds).

- `GET /v1/admin/audit/sessions/{session_id}` — same item shape filtered by **`sessionId`** (**best-effort `Scan`** in Dynamo implementation; callers should keep **`limit`** reasonable).

- `GET /v1/admin/error-logs` — optional query **`days`** (1–14, default **7**) and **`limit`** (1–500, default **300**). Admin-only; runs CloudWatch Logs Insights across Lambda log groups whose names match **`CLOUDWATCH_ADMIN_ERROR_LOG_PREFIX`** (or the default `/aws/lambda/stocvest-{STOCVEST_ENV}-api-`). Response JSON includes **`items`** (`timestamp`, `log_group`, `message`), **`log_groups`** queried, **`statistics`**, and optional **`query_error`** when Insights does not complete.

### 4.11 HTTP audit + correlation headers

- After each HTTP Lambda response routed through **`stocvest.api.lambda_dispatch`** (excluding **`authorizer`** / non-HTTP events), the runtime **best-effort** persists an **`AuditEvent`** when **`DYNAMODB_AUDIT_EVENTS_TABLE`** is set.

- Browsers integrating the SPA against API Gateway should send **`x-stocvest-session-id`** on mutating reads when convenient; it is echoed into audit rows (**`sessionId`**) for **`GET .../audit/sessions/...`** replay. Listed on API Gateway **CORS** **`allow_headers`** and on Lambda **`Access-Control-Allow-Headers`** for credentialed responses.

Terraform table **`AuditEvents`**: **`pk`** = `user#{userId|anon}`, **`sk`** = `{occurred_at ISO}#{event_id}` (**`audit_store.py`**).

### 4.12 Beta access script

- Repo script **`scripts/beta_access.py`** — operator CLI: updates **`Users`** Dynamo attributes **`betaFullAccess`**, **`betaAccessUntil`**, **`betaAccessGrantedAt`** (requires **`DYNAMODB_USERS_TABLE`** + AWS creds). Mirrors **`PATCH .../beta-access`** semantics (**`--enable` / `--disable`**). **`--until`** is optional; **`--no-expiry`** with **`--enable`** leaves beta open-ended. If **`--enable`** without **`--until`** or **`--no-expiry`**, expiry defaults to **21 days** from now (UTC). **`scripts/cognito_sub_for_email.py`** prints a user’s **`sub`** from their login email (needs **`COGNITO_USER_POOL_ID`** + **`cognito-idp:AdminGetUser`**).

### 4.13 Watchlists — symbols, desk tracking, maturation (brokers Lambda)

- `GET /v1/watchlists/default/symbols` — **authenticated**; **`{ "symbols": [...], "watchlist_name": "...", "symbol_tracking": { "TSLA": { "swing": true, "day": true } } }`**. **`symbol_tracking`** keys are uppercase tickers on the user’s default list; missing keys default to **`{ "swing": true, "day": true }`**.

- `POST /v1/watchlists/default/symbols` — body **`{ "symbol": "TSLA", "track_swing"?: boolean, "track_day"?: boolean }`** (desk flags default **true** when omitted). At least one desk must be enabled.

- `PATCH /v1/watchlists/{watchlist_id}/symbols/{symbol}/tracking` — body **`{ "track_swing": boolean, "track_day": boolean }`**; persists user desk **observation** prefs (does not mutate maturation engine state). At least one desk must be **true**.

- Watchlist list/detail responses (**`GET /v1/watchlists`**, **`GET /v1/watchlists/{id}`**, symbol add/remove) include **`symbol_tracking`** on each row (same shape as above).

- `GET /v1/watchlists/maturation-summary` — **authenticated**. Query **`mode`** = **`day`** \| **`swing`** (default **`day`**). Response JSON: **`{ "mode": "<echoed>", "by_symbol": { "AAPL": { ... } }, "near_ready_count": <int>, "near_ready_symbols": ["SYM", ...], "storage_ready": <bool>, "watchlist_symbol_count": <int> }`**. Keys in **`by_symbol`** are uppercase symbols intersected with the user’s **default** watchlist only; symbols not on the default list never appear even if a maturation row exists in Dynamo. **`near_ready_symbols`** lists symbols where **`progress_band`** is **`near_ready`** (exactly **4/6** layers aligned — display band only; **`derive_state`** still uses Developing ≥3/6, Actionable ≥5/6).

- Each **`by_symbol`** value always includes **`state`** (string enum value), **`label`** (short state label), **`progress_band`** (`not_aligned` \| `developing` \| `near_ready` \| `actionable`), **`layers_aligned`**, **`layers_total`**, and related maturation fields. **`readiness_label`** (longer layer-alignment summary) is included **only** when the user’s profile qualifies for full detail: **`subscription_plan`** ∈ {**`swing_pro`**, **`swing_day_pro`**} or **`beta_access_active`** is true (see **`stocvest/api/services/watchlist_maturation_gates.py`**). Free-tier responses omit the key.

- When **`DYNAMODB_WATCHLIST_MATURATION_TABLE`** is unset or the repository is unavailable, **`by_symbol`** is **`{}`** (HTTP 200).

- `GET /v1/watchlists/symbols/{symbol}/setup-evolution` — **authenticated**. Query **`mode`** = **`swing`** \| **`day`** (default **`swing`**). Optional **`limit`** (1–500, default 120). Symbol must be on the user’s **default** watchlist. Response: **`{ symbol, mode, started_tracking_at, has_full_access, evaluation_cadence, summary, transitions[] }`**. **`summary`** aggregates **`days_tracked`**, **`state_distribution`**, **`alignment_trend`**, **`transition_counts`**, **`latest_state`**. Plan gating: free users receive the last **14** transition rows; paid/beta receive up to **90** calendar days. Each transition includes **`from_state`**, **`to_state`**, **`layers_aligned`**, **`previous_layers_aligned`**, **`alignment_pct`**, **`bias`**, **`transition_type`** (`initial` \| `improved` \| `worsened` \| `unchanged`), **`missing_layers`**, **`evaluation_source`** (`evidence` \| `maturation_refresh`), optional **`parameter_version`**. Rows are append-only in DynamoDB **`WatchlistMaturationTransition`** (90-day TTL). Written when maturation state or meaningful alignment changes after evidence composite or scheduler refresh.

- `GET /v1/analytics/setup-outcomes` — **authenticated**. Query **`mode`** = **`swing`** \| **`day`** (default **`swing`**), **`days`** = **1–90** (default **30**). Aggregates consecutive-session outcome events from the user’s **default** watchlist symbols using the transition log (v1: alignment held / weakened; not price P&amp;L). Response: **`{ mode, days, has_full_access, watchlist_symbol_count, stats, events[], disclaimer }`**.

- `GET /v1/admin/system-behavior` — **admin** (`analysis_authorized`). Query **`mode`**, **`days`** (1–90, default 30). Uses DynamoDB GSI **`ModeTimelineIndex`** (`gsi1pk` = `MODE#swing|day`, `gsi1sk` = `{recorded_at}#{user_id}#{symbol}`) for **platform-wide** aggregates: **`transition_count`**, **`unique_users`**, **`unique_symbols`**, **`evolution_summary`**, **`outcome_stats`** (includes **`setup_continuation_rate`** when transitions carry **`price_at_event`**). Rows written before the GSI deploy omit **`gsi1pk`** and are excluded until re-logged.

### 4.14 User alerts — preferences + delivery history (brokers Lambda)

- `GET /v1/alerts/preferences` — **authenticated**; returns **`AlertPreferences`** JSON (snake_case keys).

- `PATCH /v1/alerts/preferences` — **authenticated**; partial JSON body merges into stored preferences.

- `GET /v1/alerts/history` — **authenticated**. Query **`limit`**: integer **1–50**, default **20**. Optional **`alert_type`**: a valid **`AlertType`** value (e.g. **`watchlist_maturation`**, **`signal_fired`**). Optional **`symbols`**: comma-separated tickers (uppercased server-side; each token alphanumeric plus **`.`** / **`-`**, max length **12**, up to **50** tokens). When **`alert_type`** and/or **`symbols`** is set, the service reads up to **50** newest rows, applies filters in order (**type** then **symbol**), then returns at most **`limit`** rows. Invalid **`alert_type`** → **400** (`Invalid alert_type: '…'`). When both filters are omitted, returns the newest **`limit`** rows of any type.

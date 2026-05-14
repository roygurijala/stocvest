# STOCVEST — API contracts (immutable sections)

**Last reviewed:** 2026-05-14

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

**Composite `layers[]` — sector row (additive, backward compatible):** When the **`layer`** value is **`sector`**, the object may include optional **`sic_mapping_tier`** — one of **`exact`**, **`prefix`**, **`coarse`**, **`fallback_spy`** — describing how Polygon **`sic_code`** was mapped to the internal sector bucket (see **`docs/SIGNAL_ENGINE.md`** § Sector). The field is **omitted** while sector cache is **`pending_cache_refresh`** or when tier is unknown. ETF choice and scores are unchanged from pre-tier behavior; this is metadata for debugging, analytics, and future UI.
- `POST /v1/signals/swing/composite` — build structured composite score and signal parameters from layer signals
- `POST /v1/signals/swing/synthesis/parse` — parse AI JSON synthesis output to normalized action payload
- `POST /v1/signals/day/setups` — rank intraday setup candidates from 1-minute bars
- `POST /v1/signals/swing/setups` — rank swing candidates from **daily** (`1day`) bars; body mirrors day/setups (`bars_by_symbol`, `liquidity_by_symbol`, `snapshots_by_symbol`, `regime`, optional `geo_scan_articles`) plus optional **`min_daily_bars`** (default **205** for EMA200 context). Response rows include the usual confluence fields plus **`scanner_mode": "swing_daily"`**, **`ema_daily_crossovers`**, **`weekly_rsi_recovery`**, **`weekly_rsi`**, **`volume_expansion_ratio`**, **`pattern_maturity_days`**
- `POST /v1/signals/day/briefing` — render daily briefing markdown from structured inputs
- `GET /v1/signals/recent` — public historical signal data (last 50 platform rows); optional `?landing=true`
- `GET /v1/signals/performance/summary` — directional accuracy over evaluated platform signals (1d horizon); JSON uses `correct_direction_count`, `incorrect_direction_count`, `neutral_direction_count` (legacy `win_count` / `loss_count` accepted on read in clients only)
- `GET /v1/signals/gap-intel` — **authenticated**. Query **`symbol`** (required), **`trading_mode`** (`day` \| `swing`, default **`day`**). Server fetches Polygon snapshot, same-session **1min** aggregates, optional prior-session daily bar, and optional market-status; returns a deterministic **Gap Intelligence** JSON object (`phase`, `gap`, `levels`, `liquidity`, `scenario_builder`, `flags`, `session_date`, `computed_at_utc`) plus **`disclaimer`**. Clients may forward a whitelisted subset as **`page_context.gap_intel`** to **`POST /v1/signals/assistant/chat`** (see serializer in `stocvest.signals.assistant_prompts.serialize_page_context`).
- `POST /v1/signals/gap-intel/batch` — **authenticated**. JSON body **`symbols`** (non-empty string array, max **24**), **`trading_mode`** (`day` \| `swing`). Returns **`items`** (map symbol → same snapshot shape as GET), **`errors`** (map symbol → message for per-symbol failures), and **`disclaimer`**. When **`DYNAMODB_GAP_INTEL_CACHE_TABLE`** is set, GET and batch may return cached rows keyed by symbol × mode × ET session date (soft TTL ~120s).
- `GET /v1/signals/records/{signal_id}` — single **platform** signal (404 if row is user-scoped)
- `GET /v1/signals/me/history` — authenticated user’s evaluated signals. Query: `symbol`, `days` (1–365), optional `mode` (`day` \| `swing`), optional **`page_size`** (**25** \| **50** \| **75** \| **100**, default **25**), optional **`cursor`** (opaque token from prior response’s **`next_cursor`**), optional **`ledger_only`** (`true` to return only **`ledger_qualified`** rows for the validation ledger). Legacy **`limit`**: if **`page_size`** is omitted, **`limit`** may be used; values in **25/50/75/100** map to **`page_size`**; other values clamp to **100** or **25** as implemented. Response body: **`{ "items": [ ... ], "next_cursor": string | null, "page_size": number }`**. Each row includes core D1 fields plus optional ledger keys when present: `ledger_qualified`, `closed_at`, `ledger_entry_date_et`, `ledger_exit_date_et`, `entry_rationale`, `exit_reason`, `decision_state_entry`, `decision_state_exit`, `market_regime_exit`, `gate_status` (object, parsed from `gate_status_json`), `setup_type`, `exit_rule`, `max_adverse_excursion_pct`, `max_favorable_excursion_pct`, `hold_duration_minutes`, `layer_scores`, `mode`, `status`.
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

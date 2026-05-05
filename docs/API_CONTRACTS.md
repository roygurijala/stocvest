# STOCVEST — API contracts (immutable sections)

**Last reviewed:** 2026-05-05

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
- `GET /v1/market/news?symbol={ticker?}&limit={n}` — JSON **`{ "headlines": [ ... ] }`** (not a bare array). Authenticated users merge default-watchlist tickers into the Polygon query (cap 30 merged symbols). Server fetches up to **50** Polygon rows (4h lookback), scores and dedupes, returns at most **`min(limit, 20)`** items by default client usage (`limit=20`). Each headline includes at least: **`id`**, **`title`**, **`published_utc`**, **`publisher`** (`name`, **`tier`**), **`tickers`**, **`article_url`**, **`sentiment`**, **`affected_stocks`**, **`impact_summary`**, **`relevance_score`** (0–100), **`category`** (`earnings` \| `analyst` \| `macro` \| `sector` \| `merger` \| `breaking` \| `general`), **`catalyst_category`** (legacy buckets incl. `ma` / `fda`), **`credibility`** (`label`, `band`), **`matches_watchlist`**, plus back-compat **`article_id`**, **`published_at`**, **`url`**, **`source`**, optional **`description`**, **`image_url`**.
- `GET /v1/market/options?symbol={ticker}&limit={n}[&expiration={yyyy-mm-dd}&option_type={call|put}&strike_gte={x}&strike_lte={y}]`

`timeframe` values are fixed to `Timeframe` enum values:
`1min`, `5min`, `15min`, `30min`, `1hour`, `4hour`, `1day`, `1week`.

### 4.3 Signals (Phase 4d)

- `POST /v1/signals/swing/composite` — build structured composite score and signal parameters from layer signals
- `POST /v1/signals/swing/synthesis/parse` — parse AI JSON synthesis output to normalized action payload
- `POST /v1/signals/day/setups` — rank intraday setup candidates from 1-minute bars
- `POST /v1/signals/day/briefing` — render daily briefing markdown from structured inputs
- `GET /v1/signals/recent` — public historical signal data (last 50 platform rows); optional `?landing=true`
- `GET /v1/signals/performance/summary` — directional accuracy over evaluated platform signals (1d horizon); JSON uses `correct_direction_count`, `incorrect_direction_count`, `neutral_direction_count` (legacy `win_count` / `loss_count` accepted on read in clients only)
- `GET /v1/signals/records/{signal_id}` — single **platform** signal (404 if row is user-scoped)
- `GET /v1/signals/me/history` — authenticated user’s evaluated signals; query `symbol`, `days` (1–365), `limit` (1–200)
- `GET /v1/signals/me/records/{signal_id}` — single signal for the signed-in user only

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

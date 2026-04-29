# STOCVEST — API contracts (immutable sections)

Sections referenced from `docs/CONTEXT.md` must not change without explicit review.

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
- `GET /v1/market/news?symbol={ticker?}&limit={n}`

`timeframe` values are fixed to `Timeframe` enum values:
`1min`, `5min`, `15min`, `30min`, `1hour`, `4hour`, `1day`, `1week`.

### 4.3 Signals (Phase 4d)

- `POST /v1/signals/swing/composite` — build composite score/verdict from layer signals
- `POST /v1/signals/swing/synthesis/parse` — parse AI JSON verdict to normalized action payload
- `POST /v1/signals/day/setups` — rank intraday setup candidates from 1-minute bars
- `POST /v1/signals/day/briefing` — render daily briefing markdown from structured inputs

### 4.4 Brokers (Phase 4e)

- `GET /v1/brokers/health?broker={mock|ibkr|etrade}[&account_id={id}]`
- `GET /v1/brokers/accounts?broker={mock|ibkr|etrade}`
- `GET /v1/brokers/positions?broker={mock|ibkr|etrade}&account_id={id}`
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

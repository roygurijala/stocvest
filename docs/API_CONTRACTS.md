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

## 4. HTTP API paths (reserved)

REST routes will be versioned under `/v1/` when the Lambda API (Phase 4) lands. This file will list path contracts then.

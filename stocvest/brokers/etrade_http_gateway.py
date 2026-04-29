"""Concrete E*TRADE REST gateway skeleton (sync httpx client)."""

from __future__ import annotations

from typing import Any

import httpx

from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRateLimitError,
    BrokerRejectedError,
    BrokerUnavailableError,
)


class ETradeHttpGateway:
    """
    OAuth-REST gateway for E*TRADE.

    This class intentionally keeps OAuth flow pluggable:
    - `connect()` validates credentials and initializes HTTP client.
    - Callers should provide `oauth_token` from secure token exchange/refresh flow.
    """

    def __init__(self, *, timeout_s: float = 20.0) -> None:
        self._timeout_s = timeout_s
        self._client: httpx.Client | None = None
        self._base_url: str = ""
        self._connected = False
        self._oauth_token: str | None = None
        self._order_cache_by_client_id: dict[str, dict[str, Any]] = {}

    def connect(self, *, consumer_key: str, consumer_secret: str, sandbox: bool) -> None:
        if not consumer_key or not consumer_secret:
            raise BrokerAuthError("E*TRADE consumer key/secret required")
        self._base_url = (
            "https://apisb.etrade.com"
            if sandbox
            else "https://api.etrade.com"
        )
        self._client = httpx.Client(base_url=self._base_url, timeout=self._timeout_s)
        self._connected = True

    def disconnect(self) -> None:
        if self._client is not None:
            self._client.close()
        self._client = None
        self._connected = False
        self._oauth_token = None
        self._order_cache_by_client_id.clear()

    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    def set_oauth_token(self, token: str) -> None:
        """Set OAuth access token from upstream auth flow."""
        if not token.strip():
            raise BrokerAuthError("Empty OAuth token")
        self._oauth_token = token.strip()

    def set_access_token(self, token: str) -> None:
        """Alias for OAuth token injection from auth client."""
        self.set_oauth_token(token)

    def list_accounts(self) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/v1/accounts/list.json")
        rows = payload.get("AccountListResponse", {}).get("Accounts", {}).get("Account", [])
        if isinstance(rows, dict):
            rows = [rows]
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "account_id": str(row.get("accountIdKey") or row.get("accountId") or ""),
                    "display_name": row.get("accountDesc"),
                }
            )
        return out

    def get_positions(self, account_id: str) -> list[dict[str, Any]]:
        payload = self._request_json("GET", f"/v1/accounts/{account_id}/portfolio.json")
        pos_rows = (
            payload.get("PortfolioResponse", {})
            .get("AccountPortfolio", [{}])[0]
            .get("Position", [])
        )
        if isinstance(pos_rows, dict):
            pos_rows = [pos_rows]
        out: list[dict[str, Any]] = []
        for row in pos_rows:
            product = row.get("Product", {})
            out.append(
                {
                    "symbol": str(product.get("symbol") or ""),
                    "quantity": float(row.get("quantity", 0.0)),
                    "avg_cost": (
                        float(row.get("pricePaid"))
                        if row.get("pricePaid") is not None
                        else None
                    ),
                }
            )
        return out

    def place_order(self, account_id: str, order: dict[str, Any]) -> dict[str, Any]:
        req = {
            "PlaceOrderRequest": {
                "orderType": order["order_type"].upper(),
                "clientOrderId": order["client_order_id"],
                "Order": [
                    {
                        "allOrNone": False,
                        "priceType": order["order_type"].upper(),
                        "orderTerm": order["time_in_force"].upper(),
                        "marketSession": "REGULAR",
                        "Instrument": [
                            {
                                "Product": {"symbol": order["symbol"], "securityType": "EQ"},
                                "orderAction": order["side"].upper(),
                                "quantityType": "QUANTITY",
                                "quantity": order["quantity"],
                            }
                        ],
                    }
                ],
            }
        }
        if order.get("limit_price") is not None:
            req["PlaceOrderRequest"]["Order"][0]["limitPrice"] = order["limit_price"]
        if order.get("stop_price") is not None:
            req["PlaceOrderRequest"]["Order"][0]["stopPrice"] = order["stop_price"]

        payload = self._request_json(
            "POST",
            f"/v1/accounts/{account_id}/orders/place.json",
            json=req,
        )
        placed = payload.get("PlaceOrderResponse", {})
        broker_order_id = str(
            placed.get("orderId")
            or placed.get("OrderIds", {}).get("orderId")
            or order["client_order_id"]
        )
        self._order_cache_by_client_id[order["client_order_id"]] = {
            "broker_order_id": broker_order_id,
            "symbol": order["symbol"],
            "side": order["side"],
            "status": "submitted",
            "quantity_ordered": order["quantity"],
            "quantity_filled": 0.0,
            "average_fill_price": None,
            "reject_reason": None,
        }
        return {"broker_order_id": broker_order_id}

    def cancel_order(self, account_id: str, client_order_id: str) -> None:
        cached = self._order_cache_by_client_id.get(client_order_id)
        if cached is None:
            raise BrokerNotFoundError(f"Unknown order: {client_order_id}")
        self._request_json(
            "POST",
            f"/v1/accounts/{account_id}/orders/cancel.json",
            json={"CancelOrderRequest": {"orderId": cached["broker_order_id"]}},
        )
        cached["status"] = "cancelled"

    def get_order(self, account_id: str, client_order_id: str) -> dict[str, Any] | None:
        if client_order_id in self._order_cache_by_client_id:
            return dict(self._order_cache_by_client_id[client_order_id])
        payload = self._request_json("GET", f"/v1/accounts/{account_id}/orders.json")
        orders = payload.get("OrdersResponse", {}).get("Order", [])
        if isinstance(orders, dict):
            orders = [orders]
        for row in orders:
            if str(row.get("clientOrderId")) == client_order_id:
                return {
                    "broker_order_id": str(row.get("orderId") or ""),
                    "symbol": str(row.get("symbol") or ""),
                    "side": str(row.get("orderAction", "BUY")).lower(),
                    "status": str(row.get("status", "submitted")).lower(),
                    "quantity_ordered": float(row.get("orderedQuantity", 0.0)),
                    "quantity_filled": float(row.get("filledQuantity", 0.0)),
                    "average_fill_price": (
                        float(row.get("averageExecutionPrice"))
                        if row.get("averageExecutionPrice") is not None
                        else None
                    ),
                    "reject_reason": row.get("cancelReason") or row.get("rejectionReason"),
                }
        return None

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self._client is None or not self._connected:
            raise BrokerAuthError("E*TRADE HTTP gateway is not connected")
        if not self._oauth_token:
            raise BrokerAuthError("OAuth token not set. Call set_oauth_token() first.")

        headers = {
            "Authorization": f"Bearer {self._oauth_token}",
            "Accept": "application/json",
        }
        try:
            resp = self._client.request(method, path, headers=headers, json=json)
        except httpx.RequestError as exc:
            raise BrokerUnavailableError(f"E*TRADE network error: {exc}") from exc

        if resp.status_code in (401, 403):
            raise BrokerAuthError(f"E*TRADE auth failure status={resp.status_code}")
        if resp.status_code == 404:
            raise BrokerNotFoundError(f"E*TRADE resource not found: {path}")
        if resp.status_code == 429:
            raise BrokerRateLimitError("E*TRADE rate limit")
        if resp.status_code >= 500:
            raise BrokerUnavailableError(f"E*TRADE server error status={resp.status_code}")
        if resp.status_code >= 400:
            raise BrokerRejectedError(
                f"E*TRADE rejected request status={resp.status_code} body={resp.text[:200]}"
            )

        data = resp.json()
        if not isinstance(data, dict):
            raise BrokerUnavailableError("E*TRADE returned non-object JSON payload")
        return data


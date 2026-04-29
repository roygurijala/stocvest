"""Resolve broker gateway objects from environment-backed bindings."""

from __future__ import annotations

from typing import Any

from stocvest.brokers.exceptions import BrokerUnavailableError
from stocvest.utils.config import Settings, get_settings


class BrokerGatewayProvider:
    """
    Runtime gateway resolver used by API handlers.

    Gateways are registered in-process by binding name and looked up using
    environment-backed settings (never from request payload).
    """

    def __init__(self, *, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._bindings: dict[str, Any] = {}

    def register(self, binding_name: str, gateway: Any) -> None:
        key = binding_name.strip()
        if not key:
            raise ValueError("binding_name is required")
        self._bindings[key] = gateway

    def resolve(self, broker_kind: str) -> Any | None:
        if broker_kind == "mock":
            return None
        if broker_kind == "ibkr":
            return self._require_binding(self._settings.ibkr_gateway_binding, "IBKR")
        if broker_kind == "etrade":
            return self._require_binding(self._settings.etrade_gateway_binding, "E*TRADE")
        raise BrokerUnavailableError(f"Unsupported broker kind for gateway resolution: {broker_kind}")

    def build_connect_config(self, broker_kind: str) -> dict[str, Any]:
        if broker_kind == "mock":
            return {}
        if broker_kind == "ibkr":
            return {"gateway": self.resolve("ibkr")}
        if broker_kind == "etrade":
            return {
                "gateway": self.resolve("etrade"),
                "consumer_key": self._settings.etrade_consumer_key,
                "consumer_secret": self._settings.etrade_consumer_secret,
                "sandbox": bool(self._settings.sandbox_integration_enabled),
            }
        raise BrokerUnavailableError(f"Unsupported broker kind for connect config: {broker_kind}")

    def _require_binding(self, binding_name: str, broker_label: str) -> Any:
        key = (binding_name or "").strip()
        if not key:
            raise BrokerUnavailableError(
                f"{broker_label} gateway binding is not configured in environment settings."
            )
        gateway = self._bindings.get(key)
        if gateway is None:
            raise BrokerUnavailableError(
                f"{broker_label} gateway binding '{key}' is not registered in the runtime provider."
            )
        return gateway


DEFAULT_BROKER_GATEWAY_PROVIDER = BrokerGatewayProvider()


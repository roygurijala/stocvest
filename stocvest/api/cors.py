"""HTTP CORS allowlist for API Gateway + Lambda proxy responses."""

from __future__ import annotations

from typing import Any

from stocvest.api.types import LambdaEvent

# Keep in sync with `infra/apigateway_6e.tf` `cors_configuration.allow_origins`.
ALLOWED_CORS_ORIGINS: frozenset[str] = frozenset(
    {
        "https://stocvest.ai",
        "https://www.stocvest.ai",
        "https://stocvest.app",
        "https://www.stocvest.app",
    }
)


def _is_api_gateway_http_request(event: LambdaEvent) -> bool:
    rc = event.get("requestContext")
    if not isinstance(rc, dict):
        return False
    return isinstance(rc.get("http"), dict)


def origin_from_event(event: LambdaEvent) -> str | None:
    """Return normalized Origin header if present (API Gateway v2 lowercases header keys)."""
    headers = event.get("headers")
    if not isinstance(headers, dict):
        return None
    raw = headers.get("origin") or headers.get("Origin")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def apply_cors_to_http_proxy_response(response: Any, event: LambdaEvent) -> Any:
    """
    Echo Access-Control-Allow-Origin for browser calls when Origin matches allowlist.

    Skips non-HTTP API events (EventBridge, WebSocket, JWT authorizer) and non-proxy shapes.
    """
    if not _is_api_gateway_http_request(event):
        return response
    if not isinstance(response, dict):
        return response
    if "statusCode" not in response:
        return response
    origin = origin_from_event(event)
    if not origin or origin not in ALLOWED_CORS_ORIGINS:
        return response
    headers = dict(response.get("headers") or {})
    headers["Access-Control-Allow-Origin"] = origin
    # Browsers with fetch(..., credentials: "include") require this on preflight and responses.
    headers["Access-Control-Allow-Credentials"] = "true"
    headers.setdefault("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
    headers.setdefault(
        "Access-Control-Allow-Headers",
        "authorization,content-type,x-requested-with,x-stocvest-internal-analysis,x-stocvest-session-id",
    )
    return {**response, "headers": headers}

"""Shared HTTP API route descriptor for API Gateway v2 / v1 style events."""

from __future__ import annotations

from typing import Any


def http_route_descriptor(event: dict[str, Any]) -> str:
    """Return e.g. ``GET /v1/health`` from an API Gateway–shaped Lambda event."""
    rk = event.get("routeKey")
    if isinstance(rk, str) and rk.strip():
        return rk.strip()
    http = (event.get("requestContext") or {}).get("http") or {}
    if isinstance(http, dict):
        method = str(http.get("method") or "").upper()
        path = str(http.get("path") or "")
        if method and path:
            return f"{method} {path}"
    method = str(event.get("httpMethod") or "").upper()
    path = str(event.get("path") or "")
    if method and path:
        return f"{method} {path}"
    return ""

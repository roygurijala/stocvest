"""Shared API-layer parsing/auth utilities for Lambda handlers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from stocvest.api.types import LambdaEvent


@dataclass(frozen=True)
class RequestContext:
    request_id: str
    path: str
    method: str
    user_id: str | None
    claims: dict[str, Any]
    email: str | None = None


def parse_json_body(event: LambdaEvent) -> dict[str, Any]:
    body = event.get("body")
    if body is None or body == "":
        return {}
    if isinstance(body, dict):
        return body
    if not isinstance(body, str):
        raise ValueError("Expected body to be a JSON string or object.")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("Expected JSON request body to be an object.")
    return parsed


def get_bearer_token(event: LambdaEvent) -> str | None:
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        return None
    raw = headers.get("Authorization") or headers.get("authorization")
    if not isinstance(raw, str):
        return None
    parts = raw.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def build_request_context(event: LambdaEvent) -> RequestContext:
    request_context = event.get("requestContext") or {}
    request_id = str(request_context.get("requestId") or "")
    http = request_context.get("http") or {}
    method = str(event.get("httpMethod") or http.get("method") or "")
    path = str(event.get("path") or http.get("path") or "")
    authorizer = request_context.get("authorizer") or {}
    claims = authorizer.get("claims") or {}
    if not claims and isinstance(authorizer.get("jwt"), dict):
        claims = authorizer["jwt"].get("claims") or {}
    user_id = claims.get("sub")
    raw_email = claims.get("email")
    email = str(raw_email).strip() if raw_email else None
    return RequestContext(
        request_id=request_id,
        path=path,
        method=method,
        user_id=str(user_id) if user_id is not None else None,
        claims=claims if isinstance(claims, dict) else {},
        email=email,
    )


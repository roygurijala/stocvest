"""Standard API Gateway HTTP response builders."""

from __future__ import annotations

import json
from typing import Any


DEFAULT_HEADERS = {
    "Content-Type": "application/json",
}


def json_response(
    status_code: int,
    body: dict[str, Any] | list[Any],
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    merged_headers = dict(DEFAULT_HEADERS)
    if headers:
        merged_headers.update(headers)
    return {
        "statusCode": status_code,
        "headers": merged_headers,
        "body": json.dumps(body, separators=(",", ":")),
    }


def ok(body: dict[str, Any] | list[Any]) -> dict[str, Any]:
    return json_response(200, body)


def bad_request(message: str) -> dict[str, Any]:
    return json_response(400, {"error": "bad_request", "message": message})


def unauthorized(message: str = "Unauthorized") -> dict[str, Any]:
    return json_response(401, {"error": "unauthorized", "message": message})


def forbidden(message: str = "Forbidden") -> dict[str, Any]:
    return json_response(403, {"error": "forbidden", "message": message})


def not_found(message: str = "Not found") -> dict[str, Any]:
    return json_response(404, {"error": "not_found", "message": message})


def internal_error(message: str = "Internal server error") -> dict[str, Any]:
    return json_response(500, {"error": "internal_error", "message": message})


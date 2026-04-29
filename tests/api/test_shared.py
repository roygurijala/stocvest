from __future__ import annotations

import pytest

from stocvest.api.shared import build_request_context, get_bearer_token, parse_json_body


def test_parse_json_body_with_string_payload() -> None:
    event = {"body": '{"symbol":"AAPL","qty":10}'}
    parsed = parse_json_body(event)
    assert parsed == {"symbol": "AAPL", "qty": 10}


def test_parse_json_body_returns_empty_for_missing_body() -> None:
    assert parse_json_body({}) == {}


def test_parse_json_body_rejects_non_object_json() -> None:
    with pytest.raises(ValueError):
        parse_json_body({"body": "[1,2,3]"})


def test_get_bearer_token_reads_case_insensitive_header() -> None:
    event = {"headers": {"authorization": "Bearer token-123"}}
    assert get_bearer_token(event) == "token-123"


def test_get_bearer_token_returns_none_for_invalid_scheme() -> None:
    event = {"headers": {"Authorization": "Basic abc"}}
    assert get_bearer_token(event) is None


def test_build_request_context_extracts_authorizer_claims() -> None:
    event = {
        "path": "/v1/health",
        "httpMethod": "GET",
        "requestContext": {
            "requestId": "req-1",
            "authorizer": {"claims": {"sub": "user-1", "scope": "read"}},
        },
    }
    ctx = build_request_context(event)
    assert ctx.request_id == "req-1"
    assert ctx.path == "/v1/health"
    assert ctx.method == "GET"
    assert ctx.user_id == "user-1"
    assert ctx.claims["scope"] == "read"


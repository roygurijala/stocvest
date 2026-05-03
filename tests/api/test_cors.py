from __future__ import annotations

from stocvest.api.cors import ALLOWED_CORS_ORIGINS, apply_cors_to_http_proxy_response
from stocvest.api.response import ok


def _http_event(*, origin: str | None) -> dict:
    headers: dict[str, str] = {}
    if origin is not None:
        headers["origin"] = origin
    return {
        "version": "2.0",
        "requestContext": {"http": {"method": "GET", "path": "/v1/health"}},
        "headers": headers,
    }


def test_apply_cors_adds_header_when_origin_allowed() -> None:
    ev = _http_event(origin="https://stocvest.app")
    out = apply_cors_to_http_proxy_response(ok({"x": 1}), ev)
    assert out["headers"]["Access-Control-Allow-Origin"] == "https://stocvest.app"
    assert "GET" in out["headers"]["Access-Control-Allow-Methods"]


def test_apply_cors_www_origin() -> None:
    ev = _http_event(origin="https://www.stocvest.app")
    out = apply_cors_to_http_proxy_response(ok({}), ev)
    assert out["headers"]["Access-Control-Allow-Origin"] == "https://www.stocvest.app"


def test_apply_cors_skips_unknown_origin() -> None:
    ev = _http_event(origin="https://evil.example")
    out = apply_cors_to_http_proxy_response(ok({}), ev)
    assert "Access-Control-Allow-Origin" not in out["headers"]


def test_apply_cors_skips_non_http_event() -> None:
    ev = {"source": "aws.events", "detail-type": "Scheduled Event"}
    out = apply_cors_to_http_proxy_response(ok({}), ev)
    assert "Access-Control-Allow-Origin" not in out["headers"]


def test_allowed_origins_frozenset() -> None:
    assert "https://stocvest.app" in ALLOWED_CORS_ORIGINS
    assert "https://www.stocvest.app" in ALLOWED_CORS_ORIGINS

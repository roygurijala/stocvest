from __future__ import annotations

import json

from stocvest.api.handlers.health import handler


def test_health_handler_returns_ok_payload() -> None:
    response = handler({"path": "/v1/health"}, context={})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["service"] == "stocvest-api"
    assert body["status"] == "ok"
    assert body["path"] == "/v1/health"
    assert isinstance(body["version"], str)


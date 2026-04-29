from __future__ import annotations

import json

from stocvest.api.response import bad_request, json_response, ok, unauthorized


def test_json_response_includes_default_headers() -> None:
    response = json_response(200, {"ok": True})
    assert response["statusCode"] == 200
    assert response["headers"]["Content-Type"] == "application/json"
    assert response["headers"]["Access-Control-Allow-Origin"] == "*"
    assert json.loads(response["body"]) == {"ok": True}


def test_json_response_merges_headers() -> None:
    response = json_response(201, {"id": "123"}, headers={"X-Test": "yes"})
    assert response["statusCode"] == 201
    assert response["headers"]["X-Test"] == "yes"


def test_shortcut_builders() -> None:
    assert ok({"ping": "pong"})["statusCode"] == 200
    assert bad_request("missing field")["statusCode"] == 400
    assert unauthorized()["statusCode"] == 401


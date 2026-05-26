"""Scheduled trial reminder tick."""

from __future__ import annotations

import json

import pytest

from stocvest.api.lambda_dispatch import lambda_handler


def test_brokers_trial_reminder_tick_short_circuit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setenv("TRIAL_REMINDERS_ENABLED", "false")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    resp = lambda_handler({"trial_reminder_tick": True}, {})
    assert resp["statusCode"] == 200
    body = json.loads(str(resp["body"]))
    assert body["status"] == "ok"
    assert body["scanned"] == 0

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import MagicMock

import pytest

from stocvest.api.handlers.signals import swing_composite_handler
from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.data.alert_store import get_in_memory_alert_store, new_history_alert_id
from stocvest.data.models import AlertChannel, AlertPreferences, AlertRecord, AlertStatus, AlertType
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.models.watchlist import WatchlistState
from stocvest.services.alert_trigger import AlertTriggerService
from stocvest.services.email_service import EmailService


def _ev(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    sub: str = "al-user",
    email: str = "al@example.com",
    query: dict[str, str] | None = None,
) -> dict[str, Any]:
    rk = f"{method} {path}"
    ev: dict[str, Any] = {
        "version": "2.0",
        "routeKey": rk,
        "path": path,
        "httpMethod": method,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "authorizer": {"claims": {"sub": sub, "email": email}},
            "http": {"method": method, "path": path},
        },
    }
    if query:
        ev["queryStringParameters"] = {k: str(v) for k, v in query.items()}
    return ev


def _body(resp: dict[str, Any]) -> Any:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def brokers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")


def test_alert_preferences_default_values(brokers: None) -> None:
    r = lambda_handler(_ev("GET", "/v1/alerts/preferences"), {})
    assert r["statusCode"] == 200
    b = _body(r)
    assert b["email_enabled"] is True
    assert b["on_gap_detected"] is False
    assert b.get("on_watchlist_maturation", True) is True
    assert b["watchlist_only"] is True


def test_save_and_retrieve_preferences(brokers: None) -> None:
    r1 = lambda_handler(
        _ev(
            "PATCH",
            "/v1/alerts/preferences",
            body={"email_enabled": False, "on_signal_fired": False},
        ),
        {},
    )
    assert r1["statusCode"] == 200
    assert _body(r1)["email_enabled"] is False
    r2 = lambda_handler(_ev("GET", "/v1/alerts/preferences"), {})
    assert _body(r2)["email_enabled"] is False


def test_signal_alert_skipped_when_email_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    store.save_preferences("u1", AlertPreferences(user_id="u1", email_enabled=False))
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_signal_alert_skipped_when_not_on_watchlist(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_signal_alert_skipped_below_ledger_strength_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=55,
        pattern="vwap_reclaim",
        is_confluence=False,
        confluence_score=None,
        macro_regime="neutral",
        trigger_count=3,
    )
    send.assert_not_called()


def test_signal_alert_skipped_regime_avoid(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="vwap_reclaim ema9_bounce",
        is_confluence=False,
        confluence_score=None,
        macro_regime="avoid",
        trigger_count=3,
    )
    send.assert_not_called()


def test_signal_alert_skipped_without_confirming_or_triggers(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="vwap_reclaim",
        is_confluence=False,
        confluence_score=0,
        macro_regime="neutral",
        trigger_count=1,
    )
    send.assert_not_called()


def test_signal_alert_sent_at_72_with_two_triggers(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=72,
        pattern="vwap_reclaim ema9_bounce",
        is_confluence=False,
        confluence_score=None,
        macro_regime="risk_on",
        trigger_count=2,
    )
    send.assert_called_once()


def test_signal_alert_sent_when_on_watchlist(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="swing_composite",
        is_confluence=False,
        confluence_score=None,
        macro_regime="neutral",
        ledger_qualified=True,
    )
    send.assert_called_once()


def test_confluence_alert_type_when_confluence(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=90,
        pattern="swing_composite",
        is_confluence=True,
        confluence_score=4,
    )
    assert send.call_args is not None
    assert send.call_args.kwargs["alert_type"] == AlertType.CONFLUENCE_ALERT


def test_pdt_warning_at_2_trades(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_pdt_alert(user_id="u1", user_email="a@b.com", trades_used=2)
    send.assert_called_once()
    assert send.call_args.kwargs["alert_type"] == AlertType.PDT_WARNING


def test_pdt_blocked_at_3_trades(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_pdt_alert(user_id="u1", user_email="a@b.com", trades_used=3)
    send.assert_called_once()
    assert send.call_args.kwargs["alert_type"] == AlertType.PDT_BLOCKED


def test_alert_never_blocks_signal_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(EmailService, "send_alert_email", MagicMock(side_effect=RuntimeError("ses down")))
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: MagicMock(record_signal=MagicMock()))
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "NVDA",
                "price_at_signal": 100.0,
                "signals": [
                    {"layer": "technical", "score": 0.8, "confidence": 0.9},
                    {"layer": "news", "score": 0.6, "confidence": 0.85},
                    {"layer": "macro", "score": 0.5, "confidence": 0.8},
                ],
                "symbol_snapshot": {"last_trade_price": 100.0},
            }
        ),
        "requestContext": {
            "authorizer": {"claims": {"sub": "sig-u1", "email": "sig@test.com"}},
            "http": {"method": "POST", "path": "/v1/signals/swing/composite"},
        },
        "version": "2.0",
        "routeKey": "POST /v1/signals/swing/composite",
    }
    resp = swing_composite_handler(event, {})
    assert resp["statusCode"] == 200
    time.sleep(0.08)


def test_maturation_alert_sent_when_prefs_on(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    send.assert_called_once()
    assert send.call_args.kwargs["alert_type"] == AlertType.WATCHLIST_MATURATION


def test_maturation_alert_skipped_when_desk_not_tracked(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    w = wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)
    wl.set_symbol_tracking("u1", w.watchlist_id, "AAPL", track_swing=True, track_day=False)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="day",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    send.assert_not_called()
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    send.assert_called_once()


def test_maturation_alert_skipped_when_pref_off(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    store.save_preferences("u1", AlertPreferences(user_id="u1", on_watchlist_maturation=False))
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)

    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    send.assert_not_called()


def test_maturation_alert_deduped_same_et_calendar_day(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)

    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    assert send.call_count == 1


def test_maturation_distinct_transitions_same_day_send_separately(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["AAPL"], is_default=True)

    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.ACTIONABLE,
        new_state=WatchlistState.DEVELOPING,
    )
    trig.trigger_watchlist_maturation_change(
        user_id="u1",
        user_email="a@b.com",
        symbol="AAPL",
        mode="swing",
        previous_state=WatchlistState.DEVELOPING,
        new_state=WatchlistState.INVALIDATED,
    )
    assert send.call_count == 2


def test_quiet_hours_suppresses_alert(monkeypatch: pytest.MonkeyPatch) -> None:
    send = MagicMock(return_value=True)
    monkeypatch.setattr(EmailService, "send_alert_email", send)
    monkeypatch.setattr(AlertTriggerService, "_in_quiet_hours", lambda self, prefs: True)
    store = get_in_memory_alert_store()
    wl = get_watchlist_store()
    wl.create_watchlist("u1", "D", ["NVDA"], is_default=True)
    trig = AlertTriggerService(store, EmailService(), wl)
    trig.trigger_signal_alert(
        user_id="u1",
        user_email="a@b.com",
        symbol="NVDA",
        direction="long",
        signal_strength=80,
        pattern="x",
        is_confluence=False,
        confluence_score=None,
    )
    send.assert_not_called()


def test_alerts_history_empty(brokers: None) -> None:
    r = lambda_handler(_ev("GET", "/v1/alerts/history"), {})
    assert r["statusCode"] == 200
    assert _body(r)["alerts"] == []


def _sample_alert_record(
    *,
    alert_type: AlertType,
    symbol: str | None,
    title: str,
    created_at: str = "2026-05-15T12:00:00+00:00",
) -> AlertRecord:
    return AlertRecord(
        alert_id=new_history_alert_id(),
        user_id="al-user",
        alert_type=alert_type,
        channel=AlertChannel.EMAIL,
        symbol=symbol.upper() if symbol else None,
        title=title,
        body="{}",
        status=AlertStatus.SENT,
        created_at=created_at,
        sent_at=created_at,
        error=None,
    )


def test_alerts_history_filter_by_alert_type(brokers: None) -> None:
    store = get_in_memory_alert_store()
    store.create_alert_record(
        _sample_alert_record(alert_type=AlertType.SIGNAL_FIRED, symbol="NVDA", title="NVDA signal")
    )
    store.create_alert_record(
        _sample_alert_record(alert_type=AlertType.WATCHLIST_MATURATION, symbol="AAPL", title="AAPL maturation")
    )
    r = lambda_handler(
        _ev("GET", "/v1/alerts/history", query={"limit": "10", "alert_type": "watchlist_maturation"}),
        {},
    )
    assert r["statusCode"] == 200
    alerts = _body(r)["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "watchlist_maturation"
    assert alerts[0]["symbol"] == "AAPL"


def test_alerts_history_invalid_alert_type_returns_400(brokers: None) -> None:
    r = lambda_handler(_ev("GET", "/v1/alerts/history", query={"alert_type": "nope"}), {})
    assert r["statusCode"] == 400


def test_alerts_history_filter_by_type_and_symbols(brokers: None) -> None:
    store = get_in_memory_alert_store()
    store.create_alert_record(
        _sample_alert_record(
            alert_type=AlertType.WATCHLIST_MATURATION,
            symbol="AAPL",
            title="m1",
            created_at="2026-05-15T10:00:00+00:00",
        )
    )
    store.create_alert_record(
        _sample_alert_record(
            alert_type=AlertType.WATCHLIST_MATURATION,
            symbol="MSFT",
            title="m2",
            created_at="2026-05-15T11:00:00+00:00",
        )
    )
    store.create_alert_record(
        _sample_alert_record(
            alert_type=AlertType.WATCHLIST_MATURATION,
            symbol="GOOG",
            title="m3",
            created_at="2026-05-15T12:00:00+00:00",
        )
    )
    r = lambda_handler(
        _ev(
            "GET",
            "/v1/alerts/history",
            query={"limit": "10", "alert_type": "watchlist_maturation", "symbols": "AAPL,MSFT"},
        ),
        {},
    )
    assert r["statusCode"] == 200
    alerts = _body(r)["alerts"]
    assert len(alerts) == 2
    assert {a["symbol"] for a in alerts} == {"AAPL", "MSFT"}


def test_alerts_history_filtered_small_limit_scans_up_to_50(brokers: None) -> None:
    """Regression: type/symbol filters must not use a fetch cap tied to `limit` (e.g. limit=1 → 5)."""
    store = get_in_memory_alert_store()
    store.create_alert_record(
        _sample_alert_record(alert_type=AlertType.WATCHLIST_MATURATION, symbol="AAPL", title="old-mat")
    )
    for i in range(10):
        store.create_alert_record(
            _sample_alert_record(
                alert_type=AlertType.SIGNAL_FIRED,
                symbol="NVDA",
                title=f"noise-{i}",
                created_at=f"2026-05-15T13:{i:02d}:00+00:00",
            )
        )
    r = lambda_handler(
        _ev(
            "GET",
            "/v1/alerts/history",
            query={"limit": "1", "alert_type": "watchlist_maturation", "symbols": "AAPL"},
        ),
        {},
    )
    assert r["statusCode"] == 200
    alerts = _body(r)["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["symbol"] == "AAPL"


def test_alerts_history_symbols_only_small_limit_scans_up_to_50(brokers: None) -> None:
    """``symbols`` without ``alert_type`` still widens the scan window (§4.14)."""
    store = get_in_memory_alert_store()
    store.create_alert_record(
        _sample_alert_record(alert_type=AlertType.WATCHLIST_MATURATION, symbol="AAPL", title="old-mat")
    )
    for i in range(10):
        store.create_alert_record(
            _sample_alert_record(
                alert_type=AlertType.SIGNAL_FIRED,
                symbol="NVDA",
                title=f"noise-{i}",
                created_at=f"2026-05-15T13:{i:02d}:00+00:00",
            )
        )
    r = lambda_handler(
        _ev(
            "GET",
            "/v1/alerts/history",
            query={"limit": "1", "symbols": "AAPL"},
        ),
        {},
    )
    assert r["statusCode"] == 200
    alerts = _body(r)["alerts"]
    assert len(alerts) == 1
    assert alerts[0]["symbol"] == "AAPL"
    assert alerts[0]["alert_type"] == "watchlist_maturation"

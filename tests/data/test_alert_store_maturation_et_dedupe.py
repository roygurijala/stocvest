"""Maturation alert dedupe: ET calendar day + exact transition (mode, from, to)."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from stocvest.data.alert_store import get_in_memory_alert_store, new_history_alert_id, reset_alert_stores_for_tests
from stocvest.data.models import AlertChannel, AlertRecord, AlertStatus, AlertType


@pytest.fixture(autouse=True)
def _reset_store() -> None:
    reset_alert_stores_for_tests()
    yield
    reset_alert_stores_for_tests()


def _rec(*, user_id: str, symbol: str, created_at: str) -> AlertRecord:
    return AlertRecord(
        alert_id=new_history_alert_id(),
        user_id=user_id,
        alert_type=AlertType.WATCHLIST_MATURATION,
        channel=AlertChannel.EMAIL,
        symbol=symbol,
        title="t",
        body="{}",
        status=AlertStatus.SENT,
        created_at=created_at,
        sent_at=created_at,
        error=None,
    )


def test_had_maturation_email_same_et_calendar_day() -> None:
    store = get_in_memory_alert_store()
    ref = datetime(2026, 5, 15, 18, 30, tzinfo=timezone.utc)
    store.create_alert_record(_rec(user_id="u1", symbol="AAPL", created_at=ref.isoformat()))
    assert store.had_watchlist_maturation_email_for_symbol_on_et_calendar_day("u1", "AAPL", reference_utc=ref) is True


def test_had_maturation_email_false_when_prior_et_day() -> None:
    store = get_in_memory_alert_store()
    et = ZoneInfo("America/New_York")
    # May 14, 2026 18:00 ET → UTC
    prior_et = datetime(2026, 5, 14, 18, 0, 0, tzinfo=et).astimezone(timezone.utc)
    # May 15, 2026 18:00 ET → different calendar day in NY
    ref = datetime(2026, 5, 15, 18, 0, 0, tzinfo=et).astimezone(timezone.utc)
    store.create_alert_record(_rec(user_id="u1", symbol="AAPL", created_at=prior_et.isoformat()))
    assert store.had_watchlist_maturation_email_for_symbol_on_et_calendar_day("u1", "AAPL", reference_utc=ref) is False


def _rec_with_body(
    *,
    user_id: str,
    symbol: str,
    created_at: str,
    body: str,
) -> AlertRecord:
    return AlertRecord(
        alert_id=new_history_alert_id(),
        user_id=user_id,
        alert_type=AlertType.WATCHLIST_MATURATION,
        channel=AlertChannel.EMAIL,
        symbol=symbol,
        title="t",
        body=body,
        status=AlertStatus.SENT,
        created_at=created_at,
        sent_at=created_at,
        error=None,
    )


def test_transition_dedupe_matches_mode_and_states() -> None:
    store = get_in_memory_alert_store()
    ref = datetime(2026, 5, 15, 18, 30, tzinfo=timezone.utc)
    body = '{"symbol":"AAPL","mode":"swing","previous_state":"actionable","new_state":"developing"}'
    store.create_alert_record(_rec_with_body(user_id="u1", symbol="AAPL", created_at=ref.isoformat(), body=body))
    assert (
        store.had_watchlist_maturation_transition_on_et_calendar_day(
            "u1", "AAPL", "swing", "actionable", "developing", reference_utc=ref
        )
        is True
    )
    assert (
        store.had_watchlist_maturation_transition_on_et_calendar_day(
            "u1", "AAPL", "swing", "developing", "invalidated", reference_utc=ref
        )
        is False
    )

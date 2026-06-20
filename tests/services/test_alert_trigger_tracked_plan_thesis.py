from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.data.models import AlertPreferences, AlertType
from stocvest.services.alert_trigger import AlertTriggerService

pytestmark = pytest.mark.unit


def _svc() -> tuple[AlertTriggerService, MagicMock, MagicMock]:
    store = MagicMock()
    store.get_preferences.return_value = AlertPreferences(
        user_id="u1",
        email_enabled=True,
        on_tracked_plan_thesis=True,
    )
    store.had_tracked_plan_thesis_alert_on_et_calendar_day.return_value = False
    email = MagicMock()
    email.send_alert_email.return_value = True
    email._build_subject.return_value = "STOCVEST · AAPL tracked plan"
    svc = AlertTriggerService(store, email, MagicMock())
    return svc, store, email


def test_tracked_plan_thesis_sends_on_valid_to_invalid() -> None:
    svc, store, email = _svc()
    svc.trigger_tracked_plan_thesis_change(
        user_id="u1",
        user_email="user@example.com",
        plan_id="swing:AAPL:1",
        symbol="AAPL",
        mode="swing",
        previous_status="valid",
        thesis_status="invalid",
        thesis_label="Thesis flipped",
        thesis_hint="Plan was Bullish; live read is Bearish.",
        trigger_label="Wait for entry zone",
    )
    email.send_alert_email.assert_called_once()
    assert email.send_alert_email.call_args.kwargs["alert_type"] == AlertType.TRACKED_PLAN_THESIS
    store.create_alert_record.assert_called_once()


def test_tracked_plan_thesis_skips_when_not_worsening() -> None:
    svc, store, email = _svc()
    svc.trigger_tracked_plan_thesis_change(
        user_id="u1",
        user_email="user@example.com",
        plan_id="swing:AAPL:1",
        symbol="AAPL",
        mode="swing",
        previous_status="invalid",
        thesis_status="invalid",
        thesis_label="Thesis blocked",
        thesis_hint="",
        trigger_label="Wait",
    )
    email.send_alert_email.assert_not_called()


def test_tracked_plan_thesis_respects_pref_off() -> None:
    svc, store, email = _svc()
    store.get_preferences.return_value = AlertPreferences(
        user_id="u1",
        email_enabled=True,
        on_tracked_plan_thesis=False,
    )
    svc.trigger_tracked_plan_thesis_change(
        user_id="u1",
        user_email="user@example.com",
        plan_id="swing:AAPL:1",
        symbol="AAPL",
        mode="swing",
        previous_status="valid",
        thesis_status="weakened",
        thesis_label="Thesis weakened",
        thesis_hint="",
        trigger_label="Wait",
    )
    email.send_alert_email.assert_not_called()

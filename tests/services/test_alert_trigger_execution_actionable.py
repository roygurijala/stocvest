"""Execution-actionable alert trigger."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from stocvest.data.models import AlertPreferences, AlertType
from stocvest.services.alert_trigger import AlertTriggerService


def _service() -> AlertTriggerService:
    store = MagicMock()
    email = MagicMock()
    email.send_alert_email.return_value = True
    email._build_subject.return_value = "STOCVEST · GGAL execution actionable"
    return AlertTriggerService(alert_store=store, email_service=email, watchlist_store=MagicMock())


def test_desk_funnel_sends_when_watchlist_only_and_not_on_watchlist() -> None:
    svc = _service()
    svc.alert_store.get_preferences.return_value = AlertPreferences(
        user_id="u1",
        email_enabled=True,
        watchlist_only=True,
        on_execution_actionable=True,
    )
    with patch.object(svc, "_in_quiet_hours", return_value=False), patch.object(
        svc, "_execution_actionable_email_deduped", return_value=False
    ), patch.object(svc, "_mark_execution_actionable_email_sent"):
        svc.trigger_execution_actionable(
            user_id="u1",
            user_email="roygurijala@yahoo.com",
            symbol="GGAL",
            mode="swing",
            scenario={"symbol": "GGAL"},
            on_watchlist=False,
            desk_funnel=True,
        )
    svc.email_service.send_alert_email.assert_called_once()
    assert svc.email_service.send_alert_email.call_args.kwargs["alert_type"] == AlertType.EXECUTION_ACTIONABLE


def test_non_funnel_skips_when_watchlist_only_and_not_on_watchlist() -> None:
    svc = _service()
    svc.alert_store.get_preferences.return_value = AlertPreferences(
        user_id="u1",
        email_enabled=True,
        watchlist_only=True,
        on_execution_actionable=True,
    )
    svc.trigger_execution_actionable(
        user_id="u1",
        user_email="roygurijala@yahoo.com",
        symbol="GGAL",
        mode="swing",
        scenario={"symbol": "GGAL"},
        on_watchlist=False,
        desk_funnel=False,
    )
    svc.email_service.send_alert_email.assert_not_called()

"""Execution-actionable email fan-out."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from stocvest.api.services.execution_actionable_notify import notify_execution_actionable_transition
from stocvest.data.models import AlertPreferences


def test_desk_funnel_emails_user_not_on_watchlist_when_watchlist_only() -> None:
    trig = MagicMock()
    trig.alert_store.get_preferences.return_value = AlertPreferences(
        user_id="u1",
        email_enabled=True,
        watchlist_only=True,
        on_execution_actionable=True,
    )

    wl_item = MagicMock()
    wl_item.user_id = "u1"
    wl_item.symbols = ["AAPL"]

    wl_store = MagicMock()
    wl_store.scan_default_watchlists.return_value = [wl_item]
    wl_store.get_default_watchlist.return_value = MagicMock(symbols=["AAPL"])

    profiles = MagicMock()
    profiles.get_profile.return_value = MagicMock(email="roygurijala@yahoo.com")

    with (
        patch(
            "stocvest.api.services.execution_actionable_notify.get_watchlist_store",
            return_value=wl_store,
        ),
        patch(
            "stocvest.api.services.user_profile_store.get_user_profile_store",
            return_value=profiles,
        ),
    ):
        sent = notify_execution_actionable_transition(
            "GGAL",
            "swing",
            {"symbol": "GGAL", "mode": "swing"},
            alert_trigger=trig,
            funnel_symbol=True,
        )

    assert sent == 1
    trig.trigger_execution_actionable.assert_called_once()
    kwargs = trig.trigger_execution_actionable.call_args.kwargs
    assert kwargs["desk_funnel"] is True
    assert kwargs["on_watchlist"] is False

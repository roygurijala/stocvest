"""Watchlist monitoring: scanner symbol merge, scheduled aggregation, and notify + dedup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from stocvest.api.services.scanner_scheduled_pipeline import (
    _resolve_scheduled_scan_symbols,
    merge_scheduled_scan_symbol_universe,
)
from stocvest.api.services.watchlist_scanner_alerts import notify_intraday_setups_for_watchlist_users
from stocvest.data.alert_store import InMemoryAlertStore
from stocvest.data.models import (
    AlertChannel,
    AlertRecord,
    AlertStatus,
    AlertType,
    UserProfile,
)
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS, get_scan_symbols
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.services.alert_trigger import AlertTriggerService
from stocvest.signals import IntradaySetupCandidate


def test_scanner_includes_watchlist_symbols_get_scan_symbols() -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("user-1", "Main", ["ZZZ", "AAA"], is_default=True)
    merged = get_scan_symbols("user-1", store)
    assert "ZZZ" in merged
    assert "AAA" in merged
    for sym in SYSTEM_DEFAULTS[:3]:
        assert sym in merged


def test_platform_watchlist_aggregation_merge_and_scan() -> None:
    wl = InMemoryWatchlistStore()
    wl.create_watchlist("a", "Main", ["X1", "X2"], is_default=True)
    wl.create_watchlist("b", "Main", ["X2", "X3"], is_default=True)
    items = wl.scan_default_watchlists(100)
    assert len(items) == 2
    platform: list[str] = []
    seen: set[str] = set()
    for it in items:
        for s in it.symbols:
            su = str(s).strip().upper()
            if su not in seen:
                seen.add(su)
                platform.append(su)
    out = merge_scheduled_scan_symbol_universe(["CFG1"], platform, cap=50)
    assert out[0] == "CFG1"
    assert "X1" in out and "X3" in out
    assert "SPY" in out
    assert len(out) <= 50


@pytest.mark.asyncio
async def test_watchlist_failure_never_blocks_scanner(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom() -> InMemoryWatchlistStore:
        raise RuntimeError("watchlist unavailable")

    monkeypatch.setattr(
        "stocvest.api.services.scanner_scheduled_pipeline.get_watchlist_store",
        _boom,
    )
    out = await _resolve_scheduled_scan_symbols()
    assert isinstance(out, list)
    assert "SPY" in out
    assert len(out) >= len(SYSTEM_DEFAULTS)


def test_notify_watchlist_users_fires_alert() -> None:
    from stocvest.api.services.user_profile_store import InMemoryUserProfileStore

    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", email="u1@example.com"))
    alerts = InMemoryAlertStore()
    mock_email = MagicMock()
    mock_email.send_alert_email.return_value = True
    mock_email._build_subject = MagicMock(return_value="Alert")
    trigger = AlertTriggerService(alert_store=alerts, email_service=mock_email, watchlist_store=wl)
    ts = datetime.now(timezone.utc).isoformat()
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.75,
        triggers=["orb_breakout_long", "vwap_reclaim"],
        last_price=100.0,
        vwap=None,
        ema9=None,
        timestamp_iso=ts,
    )
    notify_intraday_setups_for_watchlist_users(
        [setup],
        macro_regime="risk_on",
        watchlist_store=wl,
        alert_store=alerts,
        profile_store=profiles,
        alert_trigger=trigger,
    )
    assert mock_email.send_alert_email.called
    ctx = mock_email.send_alert_email.call_args.kwargs["context"]
    assert "ORB Long" in str(ctx.get("pattern") or "")


def test_notify_skips_regime_avoid() -> None:
    from stocvest.api.services.user_profile_store import InMemoryUserProfileStore

    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", email="u1@example.com"))
    alerts = InMemoryAlertStore()
    mock_email = MagicMock()
    mock_email.send_alert_email.return_value = True
    mock_email._build_subject = MagicMock(return_value="Alert")
    trigger = AlertTriggerService(alert_store=alerts, email_service=mock_email, watchlist_store=wl)
    ts = datetime.now(timezone.utc).isoformat()
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.8,
        triggers=["vwap_reclaim", "ema9_bounce"],
        last_price=100.0,
        vwap=None,
        ema9=None,
        timestamp_iso=ts,
    )
    notify_intraday_setups_for_watchlist_users(
        [setup],
        macro_regime="avoid",
        watchlist_store=wl,
        alert_store=alerts,
        profile_store=profiles,
        alert_trigger=trigger,
    )
    assert not mock_email.send_alert_email.called


def test_notify_skips_weak_setup_below_email_floor() -> None:
    from stocvest.api.services.user_profile_store import InMemoryUserProfileStore

    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", email="u1@example.com"))
    alerts = InMemoryAlertStore()
    mock_email = MagicMock()
    mock_email.send_alert_email.return_value = True
    mock_email._build_subject = MagicMock(return_value="Alert")
    trigger = AlertTriggerService(alert_store=alerts, email_service=mock_email, watchlist_store=wl)
    ts = datetime.now(timezone.utc).isoformat()
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.55,
        triggers=["vwap_reclaim"],
        last_price=100.0,
        vwap=None,
        ema9=None,
        timestamp_iso=ts,
    )
    notify_intraday_setups_for_watchlist_users(
        [setup],
        macro_regime="neutral",
        watchlist_store=wl,
        alert_store=alerts,
        profile_store=profiles,
        alert_trigger=trigger,
    )
    assert not mock_email.send_alert_email.called


def test_notify_skips_single_trigger_even_at_high_score() -> None:
    from stocvest.api.services.user_profile_store import InMemoryUserProfileStore

    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", email="u1@example.com"))
    alerts = InMemoryAlertStore()
    mock_email = MagicMock()
    mock_email.send_alert_email.return_value = True
    trigger = AlertTriggerService(alert_store=alerts, email_service=mock_email, watchlist_store=wl)
    ts = datetime.now(timezone.utc).isoformat()
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.8,
        triggers=["vwap_reclaim"],
        last_price=100.0,
        vwap=None,
        ema9=None,
        timestamp_iso=ts,
    )
    notify_intraday_setups_for_watchlist_users(
        [setup],
        macro_regime="neutral",
        watchlist_store=wl,
        alert_store=alerts,
        profile_store=profiles,
        alert_trigger=trigger,
    )
    assert not mock_email.send_alert_email.called


def test_notify_skips_if_recent_alert() -> None:
    from stocvest.api.services.user_profile_store import InMemoryUserProfileStore

    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", email="u1@example.com"))
    alerts = InMemoryAlertStore()
    two_h_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    alerts.create_alert_record(
        AlertRecord(
            alert_id="hist#prior",
            user_id="u1",
            alert_type=AlertType.SIGNAL_FIRED,
            channel=AlertChannel.EMAIL,
            symbol="AAPL",
            title="prior",
            body="{}",
            status=AlertStatus.SENT,
            created_at=two_h_ago,
            sent_at=two_h_ago,
            error=None,
        )
    )
    mock_email = MagicMock()
    mock_email.send_alert_email.return_value = True
    mock_email._build_subject = MagicMock(return_value="Alert")
    trigger = AlertTriggerService(alert_store=alerts, email_service=mock_email, watchlist_store=wl)
    ts = datetime.now(timezone.utc).isoformat()
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.6,
        triggers=["t"],
        last_price=1.0,
        vwap=None,
        ema9=None,
        timestamp_iso=ts,
    )
    notify_intraday_setups_for_watchlist_users(
        [setup],
        macro_regime="neutral",
        watchlist_store=wl,
        alert_store=alerts,
        profile_store=profiles,
        alert_trigger=trigger,
    )
    assert not mock_email.send_alert_email.called


def test_find_users_default_watchlist_symbol_in_memory() -> None:
    wl = InMemoryWatchlistStore()
    wl.create_watchlist("u9", "Main", ["MSFT"], is_default=True)
    assert wl.find_users_with_default_watchlist_symbol("MSFT") == ["u9"]
    assert wl.find_users_with_default_watchlist_symbol("AAPL") == []

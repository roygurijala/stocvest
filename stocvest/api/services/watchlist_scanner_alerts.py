"""Best-effort email alerts when scheduled intraday scan finds setups for symbols on users' default watchlists."""

from __future__ import annotations

from stocvest.data.alert_store import DynamoDBAlertStore, get_alert_store
from stocvest.data.watchlist_store import WatchlistStore, get_watchlist_store
from stocvest.services.alert_trigger import AlertTriggerService, get_alert_trigger
from stocvest.signals import IntradaySetupCandidate
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def notify_intraday_setups_for_watchlist_users(
    setups: list[IntradaySetupCandidate],
    *,
    watchlist_store: WatchlistStore | None = None,
    alert_store: DynamoDBAlertStore | None = None,
    profile_store: object | None = None,
    alert_trigger: AlertTriggerService | None = None,
) -> None:
    """Notify users who have the setup symbol on their default watchlist (sync; run from a daemon thread)."""
    wl = watchlist_store or get_watchlist_store()
    alerts = alert_store or get_alert_store()
    trigger = alert_trigger or get_alert_trigger()
    if profile_store is None:
        from stocvest.api.services.user_profile_store import get_user_profile_store

        profile_store = get_user_profile_store()

    for setup in setups:
        sym = setup.symbol.strip().upper()
        try:
            user_ids = wl.find_users_with_default_watchlist_symbol(sym)
        except Exception as exc:  # noqa: BLE001 — never break caller
            _LOG.warning("watchlist find users failed symbol=%s: %s", sym, exc)
            continue
        for uid in user_ids:
            try:
                if alerts.had_signal_email_for_symbol_within_hours(uid, sym, hours=4.0):
                    continue
                prof = profile_store.get_profile(uid)
                email = (prof.email or "").strip()
                if not email:
                    continue
                prefs = alerts.get_preferences(uid)
                if not prefs.email_enabled:
                    continue
                strength = int(max(0, min(100, round(float(setup.score) * 100))))
                pattern = " ".join(setup.triggers) if setup.triggers else "intraday_setup"
                trigger.trigger_signal_alert(
                    user_id=uid,
                    user_email=email,
                    symbol=sym,
                    direction=setup.direction,
                    signal_strength=strength,
                    pattern=pattern,
                    is_confluence=False,
                    confluence_score=None,
                )
            except Exception as exc:  # noqa: BLE001
                _LOG.warning(
                    "watchlist notify skipped user=%s symbol=%s: %s",
                    user_ref_for_logs(uid),
                    sym,
                    exc,
                )

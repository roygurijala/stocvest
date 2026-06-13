"""Fan out execution-actionable alert emails to opted-in users."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.services.alert_trigger import AlertTriggerService, get_alert_trigger
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

Mode = Literal["day", "swing"]


def notify_execution_actionable_transition(
    symbol: str,
    mode: Mode,
    scenario: dict[str, Any],
    *,
    alert_trigger: AlertTriggerService | None = None,
    funnel_symbol: bool = True,
) -> int:
    """
    Email users when a symbol becomes execution-actionable.

    Delivers when:
    - ``funnel_symbol`` is true (desk batch): all users with email alerts enabled, or
    - symbol is on the user's default watchlist when ``funnel_symbol`` is false.

    Returns count of send attempts.
    """
    trig = alert_trigger or get_alert_trigger()
    sym = symbol.strip().upper()
    sent = 0

    try:
        from stocvest.api.services.user_profile_store import get_user_profile_store

        profiles = get_user_profile_store()
        wl_store = get_watchlist_store()
        for item in wl_store.scan_default_watchlists(limit=500):
            uid = (item.user_id or "").strip()
            if not uid:
                continue
            prof = profiles.get_profile(uid)
            email = (prof.email or "").strip() if prof else ""
            if not email:
                continue
            wl = wl_store.get_default_watchlist(uid)
            syms = {s.strip().upper() for s in (wl.symbols if wl else item.symbols or [])}
            on_watchlist = sym in syms
            prefs = trig.alert_store.get_preferences(uid)
            # Desk funnel crosses email all opted-in users; watchlist_only applies to other alerts.
            if not on_watchlist and not funnel_symbol:
                continue
            try:
                trig.trigger_execution_actionable(
                    user_id=uid,
                    user_email=email,
                    symbol=sym,
                    mode=mode,
                    scenario=scenario,
                    on_watchlist=on_watchlist,
                    desk_funnel=funnel_symbol,
                )
                sent += 1
            except Exception as exc:  # noqa: BLE001
                _LOG.warning(
                    "execution_actionable email skipped user=%s sym=%s: %s",
                    user_ref_for_logs(uid),
                    sym,
                    exc,
                )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("execution_actionable notify scan failed: %s", exc)
    return sent

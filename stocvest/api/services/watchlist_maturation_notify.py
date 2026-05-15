"""Email alerts when default-watchlist maturation state changes (evidence path only by default)."""

from __future__ import annotations

from stocvest.models.watchlist import WatchlistMode, WatchlistState
from stocvest.services.alert_trigger import AlertTriggerService, get_alert_trigger
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def try_notify_watchlist_maturation_state_change(
    *,
    user_id: str,
    symbol: str,
    mode: WatchlistMode,
    previous_state: WatchlistState,
    new_state: WatchlistState,
    alert_trigger: AlertTriggerService | None = None,
) -> None:
    """Load profile email and fire maturation alert; never raises."""
    uid = (user_id or "").strip()
    if not uid:
        return
    if previous_state == new_state:
        return
    trig = alert_trigger or get_alert_trigger()
    try:
        from stocvest.api.services.user_profile_store import get_user_profile_store

        prof = get_user_profile_store().get_profile(uid)
        email = (prof.email or "").strip()
        if not email:
            return
        trig.trigger_watchlist_maturation_change(
            user_id=uid,
            user_email=email,
            symbol=symbol,
            mode=mode,
            previous_state=previous_state,
            new_state=new_state,
        )
    except Exception as exc:  # noqa: BLE001 — must not break composite / sync
        _LOG.warning(
            "watchlist maturation notify skipped user=%s sym=%s: %s",
            user_ref_for_logs(uid),
            (symbol or "").strip().upper(),
            exc,
        )

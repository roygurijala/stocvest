"""Evaluate alert preferences and send email + audit rows (sync; invoke from background threads)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.data.alert_store import DynamoDBAlertStore, new_history_alert_id
from stocvest.data.models import AlertChannel, AlertPreferences, AlertRecord, AlertStatus, AlertType
from stocvest.data.watchlist_store import WatchlistStore
from stocvest.models.watchlist import STATE_LABELS, WatchlistMode, WatchlistState
from stocvest.services.alert_email_present import format_alert_pattern, format_direction
from stocvest.services.alert_signal_email_gate import signal_fired_email_allowed
from stocvest.services.email_service import EmailService, preview_context_json
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


class AlertTriggerService:
    def __init__(
        self,
        alert_store: DynamoDBAlertStore,
        email_service: EmailService,
        watchlist_store: WatchlistStore,
    ) -> None:
        self.alert_store = alert_store
        self.email_service = email_service
        self.watchlist_store = watchlist_store

    def trigger_signal_alert(
        self,
        *,
        user_id: str,
        user_email: str,
        symbol: str,
        direction: str,
        signal_strength: int,
        pattern: str,
        is_confluence: bool,
        confluence_score: int | None,
        macro_regime: str | None = None,
        trigger_count: int = 0,
        ledger_qualified: bool = False,
    ) -> None:
        prefs = self.alert_store.get_preferences(user_id)
        if not prefs.email_enabled:
            return
        sym_u = symbol.strip().upper()
        if prefs.watchlist_only:
            wl = self.watchlist_store.get_default_watchlist(user_id)
            if wl and sym_u not in {s.upper() for s in wl.symbols}:
                _LOG.debug("alert skipped: %s not on default watchlist for %s", sym_u, user_ref_for_logs(user_id))
                return
        if self._in_quiet_hours(prefs):
            _LOG.debug("alert skipped: quiet hours user=%s", user_ref_for_logs(user_id))
            return
        if is_confluence and prefs.on_confluence_alert:
            alert_type = AlertType.CONFLUENCE_ALERT
        elif prefs.on_signal_fired:
            alert_type = AlertType.SIGNAL_FIRED
        else:
            return
        n_conf = int(confluence_score or 0)
        if alert_type == AlertType.SIGNAL_FIRED:
            allowed, skip = signal_fired_email_allowed(
                signal_strength=signal_strength,
                n_confirming=n_conf,
                macro_regime=macro_regime,
                trigger_count=trigger_count,
                ledger_qualified=ledger_qualified,
            )
            if not allowed:
                _LOG.debug(
                    "alert skipped: signal_fired gate %s strength=%s n_conf=%s triggers=%s regime=%s sym=%s",
                    skip,
                    signal_strength,
                    n_conf,
                    trigger_count,
                    macro_regime,
                    sym_u,
                )
                return
        ctx = {
            "symbol": sym_u,
            "direction": format_direction(direction),
            "strength": signal_strength,
            "pattern": format_alert_pattern(pattern),
            "n_confirming": n_conf,
        }
        success = self.email_service.send_alert_email(
            to_email=user_email,
            alert_type=alert_type,
            context=ctx,
        )
        now = datetime.now(timezone.utc).isoformat()
        subj = self.email_service._build_subject(alert_type, ctx)
        rec = AlertRecord(
            alert_id=new_history_alert_id(),
            user_id=user_id,
            alert_type=alert_type,
            channel=AlertChannel.EMAIL,
            symbol=sym_u,
            title=subj,
            body=preview_context_json(ctx),
            status=AlertStatus.SENT if success else AlertStatus.FAILED,
            created_at=now,
            sent_at=now if success else None,
            error=None if success else "send_failed",
        )
        self.alert_store.create_alert_record(rec)

    def trigger_pdt_alert(self, *, user_id: str, user_email: str, trades_used: int) -> None:
        prefs = self.alert_store.get_preferences(user_id)
        if not prefs.email_enabled:
            return
        if trades_used == 2 and prefs.on_pdt_warning:
            alert_type = AlertType.PDT_WARNING
        elif trades_used >= 3 and prefs.on_pdt_blocked:
            alert_type = AlertType.PDT_BLOCKED
        else:
            return
        if self._in_quiet_hours(prefs):
            _LOG.debug("pdt alert skipped: quiet hours user=%s", user_ref_for_logs(user_id))
            return
        ctx = {"trades_used": trades_used}
        success = self.email_service.send_alert_email(
            to_email=user_email,
            alert_type=alert_type,
            context=ctx,
        )
        now = datetime.now(timezone.utc).isoformat()
        subj = self.email_service._build_subject(alert_type, ctx)
        rec = AlertRecord(
            alert_id=new_history_alert_id(),
            user_id=user_id,
            alert_type=alert_type,
            channel=AlertChannel.EMAIL,
            symbol=None,
            title=subj,
            body=preview_context_json(ctx),
            status=AlertStatus.SENT if success else AlertStatus.FAILED,
            created_at=now,
            sent_at=now if success else None,
            error=None if success else "send_failed",
        )
        self.alert_store.create_alert_record(rec)

    def trigger_watchlist_maturation_change(
        self,
        *,
        user_id: str,
        user_email: str,
        symbol: str,
        mode: WatchlistMode,
        previous_state: WatchlistState,
        new_state: WatchlistState,
    ) -> None:
        if previous_state == new_state:
            return
        prefs = self.alert_store.get_preferences(user_id)
        if not prefs.email_enabled or not prefs.on_watchlist_maturation:
            return
        sym_u = symbol.strip().upper()
        wl = self.watchlist_store.get_default_watchlist(user_id)
        if prefs.watchlist_only:
            if wl and sym_u not in {s.upper() for s in wl.symbols}:
                _LOG.debug(
                    "maturation alert skipped: %s not on default watchlist for %s",
                    sym_u,
                    user_ref_for_logs(user_id),
                )
                return
        from stocvest.api.services.watchlist_tracking_prefs import is_desk_tracked_for_symbol

        if not is_desk_tracked_for_symbol(wl, sym_u, mode):
            _LOG.debug(
                "maturation alert skipped: %s desk not tracked for %s user=%s",
                mode,
                sym_u,
                user_ref_for_logs(user_id),
            )
            return
        if self._in_quiet_hours(prefs):
            _LOG.debug("maturation alert skipped: quiet hours user=%s", user_ref_for_logs(user_id))
            return
        if self.alert_store.had_watchlist_maturation_transition_on_et_calendar_day(
            user_id,
            sym_u,
            str(mode),
            previous_state.value,
            new_state.value,
        ):
            _LOG.debug(
                "maturation alert deduped (ET day + transition) user=%s sym=%s %s→%s",
                user_ref_for_logs(user_id),
                sym_u,
                previous_state.value,
                new_state.value,
            )
            return
        prev_label = STATE_LABELS.get(previous_state, previous_state.value)
        new_label = STATE_LABELS.get(new_state, new_state.value)
        ctx: dict[str, Any] = {
            "symbol": sym_u,
            "mode": mode,
            "previous_state": previous_state.value,
            "new_state": new_state.value,
            "previous_label": prev_label,
            "new_label": new_label,
        }
        success = self.email_service.send_alert_email(
            to_email=user_email,
            alert_type=AlertType.WATCHLIST_MATURATION,
            context=ctx,
        )
        now = datetime.now(timezone.utc).isoformat()
        subj = self.email_service._build_subject(AlertType.WATCHLIST_MATURATION, ctx)
        rec = AlertRecord(
            alert_id=new_history_alert_id(),
            user_id=user_id,
            alert_type=AlertType.WATCHLIST_MATURATION,
            channel=AlertChannel.EMAIL,
            symbol=sym_u,
            title=subj,
            body=preview_context_json(ctx),
            status=AlertStatus.SENT if success else AlertStatus.FAILED,
            created_at=now,
            sent_at=now if success else None,
            error=None if success else "send_failed",
        )
        self.alert_store.create_alert_record(rec)

    def trigger_execution_actionable(
        self,
        *,
        user_id: str,
        user_email: str,
        symbol: str,
        mode: str,
        scenario: dict[str, Any],
        on_watchlist: bool = True,
    ) -> None:
        """Email when a symbol crosses into execution-actionable (ledger + in-zone R/R)."""
        prefs = self.alert_store.get_preferences(user_id)
        if not prefs.email_enabled or not getattr(prefs, "on_execution_actionable", True):
            return
        sym_u = symbol.strip().upper()
        mode_s = str(mode or "").strip().lower()
        if prefs.watchlist_only and not on_watchlist:
            return
        if self._in_quiet_hours(prefs):
            _LOG.debug("execution_actionable alert skipped: quiet hours user=%s", user_ref_for_logs(user_id))
            return
        if self._execution_actionable_email_deduped(user_id, sym_u, mode_s):
            _LOG.debug(
                "execution_actionable alert deduped user=%s sym=%s mode=%s",
                user_ref_for_logs(user_id),
                sym_u,
                mode_s,
            )
            return
        ctx: dict[str, Any] = dict(scenario)
        ctx["symbol"] = sym_u
        ctx["mode"] = mode_s
        ctx["on_watchlist"] = on_watchlist
        success = self.email_service.send_alert_email(
            to_email=user_email,
            alert_type=AlertType.EXECUTION_ACTIONABLE,
            context=ctx,
        )
        now = datetime.now(timezone.utc).isoformat()
        subj = self.email_service._build_subject(AlertType.EXECUTION_ACTIONABLE, ctx)
        rec = AlertRecord(
            alert_id=new_history_alert_id(),
            user_id=user_id,
            alert_type=AlertType.EXECUTION_ACTIONABLE,
            channel=AlertChannel.EMAIL,
            symbol=sym_u,
            title=subj,
            body=preview_context_json(ctx),
            status=AlertStatus.SENT if success else AlertStatus.FAILED,
            created_at=now,
            sent_at=now if success else None,
            error=None if success else "send_failed",
        )
        self.alert_store.create_alert_record(rec)
        if success:
            self._mark_execution_actionable_email_sent(user_id, sym_u, mode_s)

    def _execution_actionable_email_deduped(self, user_id: str, symbol: str, mode: str) -> bool:
        from stocvest.utils.config import get_settings

        if get_settings().stocvest_disable_redis:
            return False
        try:
            import redis

            et_day = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
            key = f"stocvest:execution_actionable_email:{user_id}:{mode}:{symbol}:{et_day}"
            r = redis.Redis.from_url(str(get_settings().redis_url), decode_responses=True)
            return r.get(key) == "1"
        except Exception:
            return False

    def _mark_execution_actionable_email_sent(self, user_id: str, symbol: str, mode: str) -> None:
        from stocvest.utils.config import get_settings

        if get_settings().stocvest_disable_redis:
            return
        try:
            import redis

            et_day = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
            key = f"stocvest:execution_actionable_email:{user_id}:{mode}:{symbol}:{et_day}"
            r = redis.Redis.from_url(str(get_settings().redis_url), decode_responses=True)
            r.setex(key, 86400, "1")
        except Exception:
            pass

    @staticmethod
    def _in_quiet_hours(prefs: AlertPreferences) -> bool:
        if not prefs.quiet_hours_enabled:
            return False
        now_et = datetime.now(ZoneInfo("America/New_York")).strftime("%H:%M")
        start = prefs.quiet_hours_start[:5]
        end = prefs.quiet_hours_end[:5]
        if start <= end:
            return start <= now_et <= end
        return now_et >= start or now_et <= end


_trigger: AlertTriggerService | None = None


def get_alert_trigger() -> AlertTriggerService:
    global _trigger
    if _trigger is None:
        from stocvest.data.alert_store import get_alert_store
        from stocvest.data.watchlist_store import get_watchlist_store

        _trigger = AlertTriggerService(
            alert_store=get_alert_store(),
            email_service=EmailService(),
            watchlist_store=get_watchlist_store(),
        )
    return _trigger


def reset_alert_trigger_for_tests() -> None:
    global _trigger
    _trigger = None

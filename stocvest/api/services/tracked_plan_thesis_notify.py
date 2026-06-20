"""Process client-reported tracked plan thesis transitions and send email alerts."""

from __future__ import annotations

from typing import Any

from stocvest.api.text_sanitize import sanitize_free_text, sanitize_optional_free_text
from stocvest.services.alert_trigger import AlertTriggerService, get_alert_trigger
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _thesis_rank(status: str) -> int:
    s = status.strip().lower()
    if s == "invalid":
        return 2
    if s == "weakened":
        return 1
    return 0


def process_tracked_plan_thesis_alerts(
    *,
    user_id: str,
    assessments: list[dict[str, Any]],
    alert_trigger: AlertTriggerService | None = None,
) -> int:
    """Fire email for thesis transitions reported by the client. Returns send attempts."""
    uid = (user_id or "").strip()
    if not uid or not assessments:
        return 0
    trig = alert_trigger or get_alert_trigger()
    try:
        from stocvest.api.services.user_profile_store import get_user_profile_store

        prof = get_user_profile_store().get_profile(uid)
        email = (prof.email or "").strip()
        if not email:
            return 0
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("tracked_plan_thesis notify profile load failed user=%s: %s", user_ref_for_logs(uid), exc)
        return 0

    sent = 0
    for row in assessments[:24]:
        if not isinstance(row, dict):
            continue
        try:
            plan_id = str(row.get("planId") or row.get("plan_id") or "").strip()
            symbol = str(row.get("symbol") or "").strip().upper()
            mode = str(row.get("mode") or "swing").strip().lower()
            prev = str(row.get("previousStatus") or row.get("previous_status") or "valid").strip().lower()
            new = str(row.get("thesisStatus") or row.get("thesis_status") or "valid").strip().lower()
            if new not in ("weakened", "invalid"):
                continue
            if _thesis_rank(new) <= _thesis_rank(prev):
                continue
            if not plan_id or not symbol:
                continue
            # Client-supplied display strings are persisted into the Alerts table — sanitize
            # before persistence (.cursorrules §3), mirroring the trade-plan upsert path.
            thesis_label = sanitize_free_text(
                str(row.get("thesisLabel") or row.get("thesis_label") or new), max_len=120
            )
            thesis_hint = sanitize_optional_free_text(
                row.get("thesisHint") or row.get("thesis_hint"), max_len=280
            ) or ""
            trigger_label = sanitize_free_text(
                str(row.get("triggerLabel") or row.get("trigger_label") or ""), max_len=120
            )
            trig.trigger_tracked_plan_thesis_change(
                user_id=uid,
                user_email=email,
                plan_id=plan_id,
                symbol=symbol,
                mode=mode,
                previous_status=prev,
                thesis_status=new,
                thesis_label=thesis_label,
                thesis_hint=thesis_hint,
                trigger_label=trigger_label,
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001
            _LOG.warning(
                "tracked_plan_thesis notify skipped user=%s row=%s: %s",
                user_ref_for_logs(uid),
                row.get("planId") or row.get("plan_id"),
                exc,
            )
    return sent

"""Send user alert emails via AWS SES (never raises from public entrypoints)."""

from __future__ import annotations

import html
import json
from typing import Any

from stocvest.data.models import AlertType
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


class EmailService:
    """Thin SES wrapper; failures are logged and surfaced as ``False`` return values."""

    def send_alert_email(self, *, to_email: str, alert_type: AlertType, context: dict[str, Any]) -> bool:
        try:
            settings = get_settings()
            sender = (settings.stocvest_email_sender or "").strip()
            if not sender or not (to_email or "").strip():
                _LOG.warning("email send skipped: missing sender or recipient")
                return False
            subj = self._build_subject(alert_type, context)
            body_html = self._build_html_body(alert_type, context)
            import boto3

            client = boto3.client("ses", region_name=settings.aws_region)
            client.send_email(
                Source=sender,
                Destination={"ToAddresses": [to_email.strip()]},
                Message={
                    "Subject": {"Data": subj[:998], "Charset": "UTF-8"},
                    "Body": {"Html": {"Data": body_html, "Charset": "UTF-8"}},
                },
            )
            return True
        except Exception as exc:  # noqa: BLE001 — SES errors must not propagate
            _LOG.warning("SES send_alert_email failed: %s", exc)
            return False

    def send_trial_reminder_email(
        self,
        *,
        to_email: str,
        kind: str,
        days_remaining: int,
    ) -> bool:
        try:
            settings = get_settings()
            sender = (settings.stocvest_email_sender or "").strip()
            if not sender or not (to_email or "").strip():
                _LOG.warning("trial reminder skipped: missing sender or recipient")
                return False
            base = (settings.stocvest_public_app_url or "https://stocvest.ai").rstrip("/")
            if kind == "day14":
                subj = "STOCVEST · Your full-access trial ends today"
                headline = "Your trial ends today"
                detail = (
                    "Upgrade to Swing Pro or Swing + Day Pro to keep signals, scanner, "
                    "watchlists, and AI explanations."
                )
                cta = f"{base}/pricing"
                cta_label = "View plans & upgrade"
            else:
                subj = f"STOCVEST · {days_remaining} days left in your trial"
                headline = f"{days_remaining} days left in your trial"
                detail = (
                    "Your 14-day full-access trial is winding down. Upgrade anytime to keep "
                    "uninterrupted access after trial end."
                )
                cta = f"{base}/dashboard"
                cta_label = "Open Stocvest"
            body_html = self._build_trial_reminder_html(
                headline=headline,
                detail=detail,
                cta=cta,
                cta_label=cta_label,
            )
            import boto3

            client = boto3.client("ses", region_name=settings.aws_region)
            client.send_email(
                Source=sender,
                Destination={"ToAddresses": [to_email.strip()]},
                Message={
                    "Subject": {"Data": subj[:998], "Charset": "UTF-8"},
                    "Body": {"Html": {"Data": body_html, "Charset": "UTF-8"}},
                },
            )
            return True
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("SES send_trial_reminder_email failed: %s", exc)
            return False

    def _build_trial_reminder_html(
        self,
        *,
        headline: str,
        detail: str,
        cta: str,
        cta_label: str,
    ) -> str:
        import html as html_mod

        h = html_mod.escape(headline)
        d = html_mod.escape(detail)
        label = html_mod.escape(cta_label)
        cta_esc = html_mod.escape(cta)
        return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#0a1628;color:#c8dff0;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:14px;letter-spacing:0.12em;color:#00b4ff;font-weight:700;">STOCVEST</div>
    <h1 style="font-size:20px;margin:12px 0 16px;color:#e8f4ff;">{h}</h1>
    <p style="font-size:15px;line-height:1.55;color:#c8dff0;">{d}</p>
    <a href="{cta_esc}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:#00b4ff;color:#041018;
      text-decoration:none;border-radius:8px;font-weight:600;">{label}</a>
    <p style="margin-top:28px;font-size:12px;color:#6b8799;line-height:1.5;">
      You are receiving this because you started a Stocvest trial with email notifications enabled.
    </p>
  </div>
</body></html>"""

    def _build_subject(self, alert_type: AlertType, context: dict[str, Any]) -> str:
        sym = str(context.get("symbol") or "").strip().upper()
        direction = str(context.get("direction") or "").strip().lower()
        strength = int(context.get("strength") or context.get("signal_strength") or 0)
        n_conf = int(context.get("n_confirming") or 0)
        trades = int(context.get("trades_used") or 0)
        gap_pct = context.get("gap_pct")
        gap_s = f"{float(gap_pct):.2f}" if gap_pct is not None else ""

        if alert_type == AlertType.SIGNAL_FIRED:
            return f"STOCVEST · {sym} {direction} signal fired — {strength}% strength"
        if alert_type == AlertType.CONFLUENCE_ALERT:
            return f"STOCVEST · {sym} CONFLUENCE — {n_conf} signals aligning"
        if alert_type == AlertType.PDT_WARNING:
            return f"STOCVEST · PDT Warning — {trades} of 3 day trades used"
        if alert_type == AlertType.PDT_BLOCKED:
            return "STOCVEST · PDT Limit Reached — paper mode recommended"
        if alert_type == AlertType.GAP_DETECTED:
            return f"STOCVEST · {sym} gap detected — {gap_s}% pre-market"
        if alert_type == AlertType.SIGNAL_EXPIRED:
            return f"STOCVEST · {sym} ORB window closed"
        if alert_type == AlertType.WATCHLIST_MATURATION:
            mode_s = str(context.get("mode") or "").strip().lower()
            mode_part = f" ({mode_s})" if mode_s in ("swing", "day") else ""
            prev_l = str(context.get("previous_label") or context.get("previous_state") or "").strip()
            new_l = str(context.get("new_label") or context.get("new_state") or "").strip()
            arrow = f"{prev_l} → {new_l}" if prev_l and new_l else "state update"
            return f"STOCVEST · {sym}{mode_part} maturation: {arrow}"
        return "STOCVEST · Alert"

    def _build_html_body(self, alert_type: AlertType, context: dict[str, Any]) -> str:
        settings = get_settings()
        base = (settings.stocvest_public_app_url or "https://stocvest.ai").rstrip("/")
        prefs_url = f"{base}/dashboard/settings#alerts"
        sym = html.escape(str(context.get("symbol") or "").upper())
        title = html.escape(self._build_subject(alert_type, context))
        detail_rows = "".join(
            f"<tr><td style='padding:6px 12px;color:#8aa4bf;'>{html.escape(str(k))}</td>"
            f"<td style='padding:6px 12px;color:#c8dff0;font-weight:600;'>{html.escape(str(v))}</td></tr>"
            for k, v in context.items()
            if v is not None
        )
        if alert_type == AlertType.WATCHLIST_MATURATION:
            cta = f"{base}/dashboard/watchlists"
            cta_label = "View watchlists"
            disclaimer = (
                "Watchlist maturation reflects how many evidence layers align with the composite; "
                "informational only. Not investment advice."
            )
        else:
            cta = f"{base}/dashboard/signals"
            cta_label = "View signal"
            disclaimer = "Signal data for informational purposes only. Not investment advice."
        return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#0a1628;color:#c8dff0;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="font-size:14px;letter-spacing:0.12em;color:#00b4ff;font-weight:700;">STOCVEST</div>
    <h1 style="font-size:20px;margin:12px 0 16px;color:#e8f4ff;">{title}</h1>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">{detail_rows}</table>
    <a href="{cta}" style="display:inline-block;padding:12px 20px;background:#00b4ff;color:#041018;
      text-decoration:none;border-radius:8px;font-weight:600;">{html.escape(cta_label)}</a>
    <p style="margin-top:28px;font-size:12px;color:#6b8799;line-height:1.5;">
      {disclaimer}
    </p>
    <p style="font-size:12px;color:#6b8799;">
      <a href="{prefs_url}" style="color:#00b4ff;">Manage alert preferences</a>
    </p>
  </div>
</body></html>"""


def preview_context_json(context: dict[str, Any]) -> str:
    try:
        return json.dumps(context, default=str)[:8000]
    except Exception:
        return "{}"

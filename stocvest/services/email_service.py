"""Send user alert and trial emails via Postmark (never raises from public entrypoints)."""

from __future__ import annotations

import html
import json
from typing import Any

from stocvest.data.models import AlertType
from stocvest.services.alert_email_present import format_direction
from stocvest.services.postmark_client import send_postmark_html_email
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


class EmailService:
    """Thin Postmark wrapper; failures are logged and surfaced as ``False`` return values."""

    def send_alert_email(self, *, to_email: str, alert_type: AlertType, context: dict[str, Any]) -> bool:
        try:
            settings = get_settings()
            sender = (settings.stocvest_email_sender or "").strip()
            token = (settings.postmark_server_token or "").strip()
            if not sender or not token or not (to_email or "").strip():
                _LOG.warning("email send skipped: missing sender, Postmark token, or recipient")
                return False
            subj = self._build_subject(alert_type, context)
            body_html = self._build_html_body(alert_type, context)
            ok = send_postmark_html_email(
                server_token=token,
                sender=sender,
                to_email=to_email.strip(),
                subject=subj,
                html_body=body_html,
                message_stream=settings.postmark_message_stream,
            )
            if not ok:
                _LOG.warning("Postmark send_alert_email failed for %s", to_email.strip())
            return ok
        except Exception as exc:  # noqa: BLE001 — delivery errors must not propagate
            _LOG.warning("Postmark send_alert_email failed: %s", exc)
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
            token = (settings.postmark_server_token or "").strip()
            if not sender or not token or not (to_email or "").strip():
                _LOG.warning("trial reminder skipped: missing sender, Postmark token, or recipient")
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
            ok = send_postmark_html_email(
                server_token=token,
                sender=sender,
                to_email=to_email.strip(),
                subject=subj,
                html_body=body_html,
                message_stream=settings.postmark_message_stream,
            )
            if not ok:
                _LOG.warning("Postmark send_trial_reminder_email failed for %s", to_email.strip())
            return ok
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("Postmark send_trial_reminder_email failed: %s", exc)
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
        return self._email_shell(
            headline=h,
            body_html=f'<p style="font-size:15px;line-height:1.55;color:#1a2b3c;margin:0 0 8px;">{d}</p>',
            cta_href=cta_esc,
            cta_label=label,
            footer_note=(
                "You are receiving this because you started a Stocvest trial with email notifications enabled."
            ),
        )

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

    def _alert_detail_rows(self, alert_type: AlertType, context: dict[str, Any]) -> list[tuple[str, str]]:
        if alert_type == AlertType.WATCHLIST_MATURATION:
            mode_s = str(context.get("mode") or "").strip().lower()
            mode_label = "Swing" if mode_s == "swing" else "Day" if mode_s == "day" else mode_s.capitalize()
            rows: list[tuple[str, str]] = [
                ("Symbol", str(context.get("symbol") or "").upper()),
                ("Desk", mode_label or "—"),
                ("Change", f"{context.get('previous_label') or '—'} → {context.get('new_label') or '—'}"),
            ]
            return rows
        sym = str(context.get("symbol") or "").upper()
        direction = format_direction(str(context.get("direction") or ""))
        strength = int(context.get("strength") or context.get("signal_strength") or 0)
        pattern = str(context.get("pattern") or "—")
        rows = [
            ("Symbol", sym),
            ("Direction", direction),
            ("Strength", f"{strength}%"),
            ("Setup", pattern),
        ]
        n_conf = int(context.get("n_confirming") or 0)
        if alert_type == AlertType.CONFLUENCE_ALERT or n_conf > 0:
            rows.append(("Confirming layers", str(n_conf)))
        return rows

    @staticmethod
    def _email_shell(
        *,
        headline: str,
        body_html: str,
        cta_href: str,
        cta_label: str,
        footer_note: str,
        prefs_url: str | None = None,
        disclaimer: str | None = None,
    ) -> str:
        prefs_line = ""
        if prefs_url:
            prefs_line = (
                f'<p style="font-size:12px;color:#5c6f82;margin:8px 0 0;">'
                f'<a href="{html.escape(prefs_url)}" style="color:#0077c8;">Manage alert preferences</a></p>'
            )
        disc = ""
        if disclaimer:
            disc = (
                f'<p style="margin-top:20px;font-size:12px;color:#5c6f82;line-height:1.5;">'
                f"{html.escape(disclaimer)}</p>"
            )
        footer = ""
        if footer_note:
            footer = (
                f'<p style="margin-top:20px;font-size:12px;color:#5c6f82;line-height:1.5;">'
                f"{html.escape(footer_note)}</p>"
            )
        return f"""<!DOCTYPE html>
<html><head><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/></head>
<body style="margin:0;padding:24px;background:#f4f7fa;color:#1a2b3c;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d8e2ec;border-radius:12px;padding:24px;">
    <div style="font-size:13px;letter-spacing:0.12em;color:#0077c8;font-weight:700;">STOCVEST</div>
    <h1 style="font-size:20px;margin:12px 0 16px;color:#0f1c2e;font-weight:700;line-height:1.35;">{headline}</h1>
    {body_html}
    <a href="{cta_href}" style="display:inline-block;margin-top:20px;padding:12px 20px;background:#0077c8;color:#ffffff;
      text-decoration:none;border-radius:8px;font-weight:600;">{cta_label}</a>
    {disc}
    {footer}
    {prefs_line}
  </div>
</body></html>"""

    def _build_html_body(self, alert_type: AlertType, context: dict[str, Any]) -> str:
        settings = get_settings()
        base = (settings.stocvest_public_app_url or "https://stocvest.ai").rstrip("/")
        prefs_url = f"{base}/dashboard/settings#alerts"
        title = html.escape(self._build_subject(alert_type, context))
        detail_rows = "".join(
            f"<tr><td style='padding:8px 12px;color:#5c6f82;font-size:14px;vertical-align:top;width:38%;'>"
            f"{html.escape(label)}</td>"
            f"<td style='padding:8px 12px;color:#0f1c2e;font-size:14px;font-weight:600;'>"
            f"{html.escape(str(value))}</td></tr>"
            for label, value in self._alert_detail_rows(alert_type, context)
        )
        table_html = (
            f'<table style="width:100%;border-collapse:collapse;margin:0 0 8px;background:#f8fafc;'
            f'border-radius:8px;">{detail_rows}</table>'
            if detail_rows
            else ""
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
        return self._email_shell(
            headline=title,
            body_html=table_html,
            cta_href=html.escape(cta),
            cta_label=html.escape(cta_label),
            footer_note="",
            prefs_url=prefs_url,
            disclaimer=disclaimer,
        )


def preview_context_json(context: dict[str, Any]) -> str:
    try:
        return json.dumps(context, default=str)[:8000]
    except Exception:
        return "{}"

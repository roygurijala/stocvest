"""Postmark transactional email API (https://postmarkapp.com/developer/api/email-api)."""

from __future__ import annotations

import httpx

POSTMARK_EMAIL_URL = "https://api.postmarkapp.com/email"


def send_postmark_html_email(
    *,
    server_token: str,
    sender: str,
    to_email: str,
    subject: str,
    html_body: str,
    message_stream: str = "outbound",
    timeout_seconds: float = 30.0,
) -> bool:
    """
    Send one HTML email via Postmark. Returns True on HTTP 200.

    Never raises — callers treat False as a soft failure.
    """
    token = (server_token or "").strip()
    from_addr = (sender or "").strip()
    to_addr = (to_email or "").strip()
    if not token or not from_addr or not to_addr:
        return False
    payload = {
        "From": from_addr,
        "To": to_addr,
        "Subject": (subject or "")[:998],
        "HtmlBody": html_body,
        "MessageStream": (message_stream or "outbound").strip() or "outbound",
    }
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
    }
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(POSTMARK_EMAIL_URL, headers=headers, json=payload)
        if resp.status_code != 200:
            return False
        # A true accept is HTTP 200 *and* ErrorCode 0. Postmark can return 200 with a
        # non-zero ErrorCode (e.g. inactive recipient / account sending blocked); treat
        # those as soft failures so callers record FAILED rather than a misleading SENT.
        try:
            data = resp.json()
        except ValueError:
            return False
        return int(data.get("ErrorCode", -1)) == 0
    except httpx.HTTPError:
        return False

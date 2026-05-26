"""Best-effort Cognito email lookup for scheduled jobs."""

from __future__ import annotations

from stocvest.api.services.admin_user_directory import get_cognito_user_by_sub


class DefaultCognitoEmailLookup:
    def get_email_for_sub(self, user_id: str) -> str | None:
        uid = (user_id or "").strip()
        if not uid:
            return None
        try:
            rec = get_cognito_user_by_sub(uid)
        except Exception:
            return None
        if rec is None:
            return None
        email = (rec.email or "").strip()
        return email or None

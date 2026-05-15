"""Plan gates for watchlist maturation API responses."""

from __future__ import annotations

from stocvest.data.models import UserProfile


def maturation_summary_include_readiness_label(profile: UserProfile) -> bool:
    """
    Paid plans (and active beta full access) receive the detailed ``readiness_label``
    string on ``GET /v1/watchlists/maturation-summary``. Free-tier responses keep
    ``state`` and coarse ``label`` only (see ``docs/WATCHLIST_PIPELINE_IMPLEMENTATION_PROMPT.md`` Part 6).
    """
    if profile.beta_access_active:
        return True
    plan = (profile.subscription_plan or "free").strip().lower()
    return plan in ("swing_pro", "swing_day_pro")

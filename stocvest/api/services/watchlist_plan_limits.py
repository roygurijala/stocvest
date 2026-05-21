"""Plan-based default-watchlist symbol caps (SSOT for API, store, scheduler, UI)."""

from __future__ import annotations

from stocvest.data.models import UserProfile

WATCHLIST_SYMBOL_CAP_FREE = 5
WATCHLIST_SYMBOL_CAP_SWING_PRO = 50
WATCHLIST_SYMBOL_CAP_SWING_DAY_PRO = 100

# Hard ceiling for malformed plan strings / env overrides in store layer.
WATCHLIST_SYMBOL_CAP_ABSOLUTE_MAX = 100


def watchlist_symbol_cap_for_profile(profile: UserProfile | None) -> int:
    """
    Default-list symbol slots by subscription (and beta full access → top tier).

    - ``free`` → 5
    - ``swing_pro`` → 50
    - ``swing_day_pro`` → 100
    """
    if profile is not None and profile.beta_access_active:
        return WATCHLIST_SYMBOL_CAP_SWING_DAY_PRO
    plan = (profile.subscription_plan if profile else "free") or "free"
    plan = plan.strip().lower()
    if plan == "swing_day_pro":
        return WATCHLIST_SYMBOL_CAP_SWING_DAY_PRO
    if plan == "swing_pro":
        return WATCHLIST_SYMBOL_CAP_SWING_PRO
    return WATCHLIST_SYMBOL_CAP_FREE


def watchlist_symbol_limit_message(cap: int) -> str:
    n = max(1, min(int(cap), WATCHLIST_SYMBOL_CAP_ABSOLUTE_MAX))
    return f"Watchlist may contain at most {n} symbols."

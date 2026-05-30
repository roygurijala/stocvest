"""Whether a ``signal_fired`` email should send (aligned with validation ledger floors)."""

from __future__ import annotations

from stocvest.api.services.signal_validation_eligibility import MIN_ACTIONABLE_SCORE_0_100
from stocvest.config.signal_parameters import default_signal_parameters

# Human-readable skip reasons for logs/tests.
SKIP_STRENGTH = "strength_below_72"
SKIP_REGIME = "macro_regime_avoid"
SKIP_CONFIRMING = "insufficient_confirming"


def min_signal_fired_email_strength() -> int:
    """Same floor as portfolio / ledger auto-log (``MIN_ACTIONABLE_SCORE_0_100``)."""
    return MIN_ACTIONABLE_SCORE_0_100


def min_signal_fired_email_confirming() -> int:
    return int(default_signal_parameters().composite.alert_email_min_confirming)


def signal_fired_email_allowed(
    *,
    signal_strength: int,
    n_confirming: int = 0,
    macro_regime: str | None = None,
    trigger_count: int = 0,
    ledger_qualified: bool = False,
) -> tuple[bool, str | None]:
    """Return ``(allowed, skip_reason)`` for non-confluence signal-fired emails.

    Ledger-qualified composites already passed score ≥ 72, regime, alignment, and R/R gates.
    Scanner / legacy callers must satisfy the same floors explicitly.
    """
    if ledger_qualified:
        return True, None

    if int(signal_strength) < min_signal_fired_email_strength():
        return False, SKIP_STRENGTH

    regime = str(macro_regime or "").strip().lower()
    if regime == "avoid":
        return False, SKIP_REGIME

    min_conf = min_signal_fired_email_confirming()
    if int(n_confirming) >= min_conf:
        return True, None
    if int(trigger_count) >= min_conf:
        return True, None

    return False, SKIP_CONFIRMING

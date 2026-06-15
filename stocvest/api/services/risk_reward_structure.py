"""Risk/reward from reference entry, stop, and target levels (shared evidence + gates)."""

from __future__ import annotations

from stocvest.api.services.target_provenance import target_2_eligible_for_gate


def round_risk_reward_display(rr: float) -> float:
    """Cap display/API R/R; do not floor sub-0.5 values (that hid real geometry)."""
    return round(min(10.0, max(0.0, float(rr))), 1)


def rr_from_levels_long(entry: float, target: float, stop: float) -> float | None:
    risk = entry - stop
    reward = target - entry
    if risk <= 1e-6 or reward <= 1e-6:
        return None
    return float(reward / risk)


def rr_from_levels_short(entry: float, target: float, stop: float) -> float | None:
    risk = stop - entry
    reward = entry - target
    if risk <= 1e-6 or reward <= 1e-6:
        return None
    return float(reward / risk)


def structure_risk_reward_long(
    entry: float,
    target_1: float,
    stop: float,
    target_2: float | None = None,
    target_2_provenance: str | None = None,
) -> float | None:
    """
    Prefer T1 when tradable. Promote to T2 only when T2 is structurally anchored
    (resistance) and improves a sub-1:1 T1. Unanchored T2 never clears the gate.
    """
    rr_t1 = rr_from_levels_long(entry, target_1, stop)
    if target_2 is None:
        return rr_t1
    rr_t2 = rr_from_levels_long(entry, target_2, stop)
    if not target_2_eligible_for_gate(target_2_provenance):
        if rr_t1 is not None and rr_t1 < 1.0:
            return None
        return rr_t1
    if rr_t1 is None:
        return rr_t2
    if rr_t2 is None:
        return rr_t1
    if rr_t1 < 1.0 and rr_t2 > rr_t1:
        return rr_t2
    return rr_t1


def structure_risk_reward_short(
    entry: float,
    target_1: float,
    stop: float,
    target_2: float | None = None,
    target_2_provenance: str | None = None,
) -> float | None:
    rr_t1 = rr_from_levels_short(entry, target_1, stop)
    if target_2 is None:
        return rr_t1
    rr_t2 = rr_from_levels_short(entry, target_2, stop)
    if not target_2_eligible_for_gate(target_2_provenance):
        if rr_t1 is not None and rr_t1 < 1.0:
            return None
        return rr_t1
    if rr_t1 is None:
        return rr_t2
    if rr_t2 is None:
        return rr_t1
    if rr_t1 < 1.0 and rr_t2 > rr_t1:
        return rr_t2
    return rr_t1

"""Personal-mode conviction sleeves for portfolio review sizing.

Operator-agreed policy (not ticker weights). Conviction comes from signals the
desk already computes (verdict, holder stance, structure-broken, fund vehicle).
Risk is the band + a single-name cap. No Kelly / correlation math.

Bands (add toward the floor, trim to the high, never above the cap):

    core      10–12%   operating company, bullish + constructive
    standard   6–9%    hold / caution / intact but not a core add
    vehicle    4–6%    fund/ETF product
    exit       0–3%    bearish + defensive, or structure-broken (non-vehicle)

    single-name max 15%

Explicit ``targetPositionPct`` in settings still wins (one point target for every
name). Product mode + null target still emits no amounts.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class PositionSleeve(str, Enum):
    CORE = "core"
    STANDARD = "standard"
    VEHICLE = "vehicle"
    EXIT = "exit"


# Operator-agreed personal policy. Do not invent a different band without a new decision.
SLEEVE_BANDS: dict[PositionSleeve, tuple[float, float]] = {
    PositionSleeve.CORE: (10.0, 12.0),
    PositionSleeve.STANDARD: (6.0, 9.0),
    PositionSleeve.VEHICLE: (4.0, 6.0),
    PositionSleeve.EXIT: (0.0, 3.0),
}

SINGLE_NAME_MAX_PCT = 15.0

SLEEVE_POLICY_SUMMARY = (
    "Conviction sleeves: core 10–12%, standard 6–9%, vehicle 4–6%, exit 0–3%; "
    "single-name max 15%. Add only below the sleeve floor; trim only above the "
    "sleeve high. Sell still reduces the full position. Hold + caution does not add."
)

_SLEEVE_LABELS: dict[PositionSleeve, str] = {
    PositionSleeve.CORE: "core",
    PositionSleeve.STANDARD: "standard",
    PositionSleeve.VEHICLE: "vehicle",
    PositionSleeve.EXIT: "exit",
}


@dataclass(frozen=True)
class SleevePolicy:
    sleeve: PositionSleeve
    low_pct: float
    high_pct: float

    @property
    def label(self) -> str:
        return _SLEEVE_LABELS[self.sleeve]

    def band_phrase(self) -> str:
        return f"{self.low_pct:.0f}–{self.high_pct:.0f}%"


def resolve_position_sleeve(
    *,
    is_fund_vehicle: bool = False,
    verdict: str | None = None,
    stance: str | None = None,
    structure_broken: bool = False,
) -> PositionSleeve:
    """Map existing desk signals to a sleeve. No new numeric thresholds.

    Order: full-exit read (bearish + defensive) → structure-broken operating
    company → fund vehicle → core add → standard.
    """
    verdict_l = (verdict or "").strip().lower()
    stance_l = (stance or "").strip().lower()
    if verdict_l == "bearish" and stance_l == "defensive":
        return PositionSleeve.EXIT
    if structure_broken and not is_fund_vehicle:
        return PositionSleeve.EXIT
    if is_fund_vehicle:
        return PositionSleeve.VEHICLE
    if verdict_l == "bullish" and stance_l == "constructive":
        return PositionSleeve.CORE
    return PositionSleeve.STANDARD


def sleeve_policy_for(sleeve: PositionSleeve) -> SleevePolicy:
    low, high = SLEEVE_BANDS[sleeve]
    return SleevePolicy(
        sleeve=sleeve,
        low_pct=low,
        high_pct=min(high, SINGLE_NAME_MAX_PCT),
    )


def resolve_sleeve_policy(
    *,
    is_fund_vehicle: bool = False,
    verdict: str | None = None,
    stance: str | None = None,
    structure_broken: bool = False,
) -> SleevePolicy:
    return sleeve_policy_for(
        resolve_position_sleeve(
            is_fund_vehicle=is_fund_vehicle,
            verdict=verdict,
            stance=stance,
            structure_broken=structure_broken,
        )
    )


def scale_sleeve_policies(policies: list[SleevePolicy]) -> list[SleevePolicy]:
    """If sleeve highs sum to more than 100%, scale lows and highs pro-rata.

    Prevents an all-core 12-name book from targeting 144% invested. Does not
    invent new conviction — it is a book-completeness constraint.
    """
    if not policies:
        return []
    total_high = sum(p.high_pct for p in policies)
    if total_high <= 100.0:
        return list(policies)
    factor = 100.0 / total_high
    scaled: list[SleevePolicy] = []
    for p in policies:
        high = min(round(p.high_pct * factor, 4), SINGLE_NAME_MAX_PCT)
        low = min(round(p.low_pct * factor, 4), high)
        scaled.append(SleevePolicy(sleeve=p.sleeve, low_pct=low, high_pct=high))
    return scaled


def weight_vs_sleeve(
    weight_pct: float | None,
    policy: SleevePolicy,
) -> tuple[bool, bool]:
    """``(over_high, under_low)``. A weight inside the band is neither."""
    if weight_pct is None:
        return False, False
    return weight_pct > policy.high_pct, weight_pct < policy.low_pct

"""T2 target provenance — gate eligibility for headline R/R (keep in sync with frontend/lib/target-provenance.ts)."""

from __future__ import annotations

from typing import Literal

Target2Provenance = Literal["2r_extension", "t1_bump", "resistance"]


def target_2_eligible_for_gate(provenance: str | None) -> bool:
    """Only structurally validated resistance may clear desk R/R via T2 promotion."""
    return provenance == "resistance"


def target_2_provenance_label(provenance: str | None, direction: str = "bullish") -> str | None:
    if provenance == "2r_extension":
        return "2R projection — unanchored"
    if provenance == "t1_bump":
        return "T1 bump — unanchored"
    # "resistance" means "anchored at a real structural level" regardless of side; for a
    # short the downside T2 is anchored to *support*, so the label flips.
    if provenance == "resistance":
        return "Support-anchored" if direction == "bearish" else "Resistance-anchored"
    return None

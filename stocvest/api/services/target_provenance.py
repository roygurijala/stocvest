"""T2 target provenance — gate eligibility for headline R/R (keep in sync with frontend/lib/target-provenance.ts)."""

from __future__ import annotations

from typing import Literal

# "analyst_target" (B78): a T2 implied by an analyst price target. Surfaced honestly but it is
# NOT a structurally-scanned level, so it never clears the desk R/R gate.
# "atr_extension" (B78): a volatility-projected T2 (entry + beta*ATR) — unanchored, never gates.
Target2Provenance = Literal["2r_extension", "t1_bump", "resistance", "atr_extension", "analyst_target"]


def target_2_eligible_for_gate(provenance: str | None) -> bool:
    """Only structurally validated resistance may clear desk R/R via T2 promotion."""
    return provenance == "resistance"


def target_2_provenance_label(provenance: str | None, direction: str = "bullish") -> str | None:
    if provenance == "2r_extension":
        return "2R projection — unanchored"
    if provenance == "atr_extension":
        return "ATR projection — unanchored"
    if provenance == "t1_bump":
        return "T1 bump — unanchored"
    if provenance == "analyst_target":
        return "Analyst-target-implied — not structural"
    # "resistance" means "anchored at a real structural level" regardless of side; for a
    # short the downside T2 is anchored to *support*, so the label flips.
    if provenance == "resistance":
        return "Support-anchored" if direction == "bearish" else "Resistance-anchored"
    return None

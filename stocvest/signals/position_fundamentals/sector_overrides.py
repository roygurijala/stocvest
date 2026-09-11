"""Sector-specific pillar adjustments (ADR-004 POS-AI-5).

Table-driven overrides so the F-pillar scorers apply sector-appropriate metric selection
and suppress inappropriate *generic* red flags — **without inventing new numeric
thresholds**. Each internal sector bucket emitted by ``SectorMapper`` (e.g. ``banks``,
``real_estate``, ``biotech``) maps to one :class:`SectorOverrideFlags` row.

Deliberately conservative. Overrides only:

* **(a)** choose a sector-appropriate quality metric — ROA vs ROIC/ROCE (financials);
* **(b)** de-emphasize standard valuation where GAAP multiples are structurally
  misleading (pre-profit biotech; REITs, where depreciation distorts P/E vs P/FFO);
* **(c)** suppress the generic high-D/E *red flag* for business models that are
  structurally levered (banks, REITs), replacing it with an informational chip so the
  glass-box read explains *why* leverage is not scored as a solvency red flag there.

Precise sector proxies (bank CET1 / NPL, P/TBV; REIT P/FFO / REIT-debt) and the F7/F8
pillars are **POS-AI-5 v2** — they require verified FMP inputs and a coordinated pillar-set
change, so they are intentionally NOT implemented here (no guessed financial math).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SectorOverrideFlags:
    """Sector-appropriate adjustments applied by the F-pillar scorers.

    All flags default off so a name with no (or an unknown) sector bucket scores on the
    generic F1–F5 rules — the override layer is purely additive and reversible.
    """

    #: F1 — use return-on-assets instead of ROIC/ROCE (financials carry little "capital
    #: employed" in the industrial sense; ROA is the standard efficiency lens).
    use_roa_not_roic: bool = False
    #: F4 — apply a small de-emphasis to standard valuation (pre-profit / REIT names where
    #: GAAP P/E systematically overstates expensiveness).
    de_weight_valuation: bool = False
    #: F3 — do not score raw debt/equity: this business model is structurally levered
    #: (banks fund with deposits; REITs with mortgage debt), so a high D/E is not a
    #: solvency red flag. Interest-coverage / liquidity checks still apply.
    structural_high_leverage: bool = False
    #: F1 — do not penalize negative free cash flow: for lenders (banks/consumer finance)
    #: FCF is dominated by loan originations held on balance sheet, so it is structurally
    #: negative even when the business is GAAP-profitable. Gated behind fundamentals-v2.
    suppress_fcf_penalty: bool = False
    #: F3 — do not score the classic current ratio: banks/insurers do not have an
    #: industrial current-asset/liability structure, so a sub-1.0 ratio is not a liquidity
    #: red flag. Gated behind fundamentals-v2.
    suppress_current_ratio: bool = False
    #: F4 — optional chip text explaining the sector-appropriate valuation lens; when set it
    #: replaces the default de-weight chip.
    valuation_note: str | None = None
    #: The resolved bucket, echoed for reasoning/telemetry.
    sector_label: str | None = None


# Bucket families (values match the internal buckets emitted by ``SectorMapper``).
_BANK_BUCKETS = ("banks", "insurance", "consumer_finance", "investment_services")
_REIT_BUCKETS = ("real_estate", "reits")
_PREPROFIT_BUCKETS = ("biotech", "pharma")

_REIT_VALUATION_NOTE = "REIT — judge valuation on P/FFO, not P/E"


def _build_sector_override_table() -> dict[str, SectorOverrideFlags]:
    """Materialize the bucket → flags lookup table once at import time."""
    table: dict[str, SectorOverrideFlags] = {}
    for bucket in _BANK_BUCKETS:
        # Banks/insurers: ROA over ROIC, and leverage is structural (deposits/float).
        # FCF (loan originations) and the classic current ratio are non-meaningful for
        # lenders, so v2 suppresses those generic penalties.
        table[bucket] = SectorOverrideFlags(
            use_roa_not_roic=True,
            structural_high_leverage=True,
            suppress_fcf_penalty=True,
            suppress_current_ratio=True,
            sector_label=bucket,
        )
    for bucket in _REIT_BUCKETS:
        # REITs: high mortgage leverage is normal; GAAP P/E is distorted by depreciation.
        table[bucket] = SectorOverrideFlags(
            de_weight_valuation=True,
            structural_high_leverage=True,
            valuation_note=_REIT_VALUATION_NOTE,
            sector_label=bucket,
        )
    for bucket in _PREPROFIT_BUCKETS:
        # Biotech/pharma: often pre-profit; valuation multiples are noisy.
        table[bucket] = SectorOverrideFlags(
            de_weight_valuation=True,
            sector_label=bucket,
        )
    return table


_SECTOR_OVERRIDE_TABLE: dict[str, SectorOverrideFlags] = _build_sector_override_table()


def resolve_sector_override_flags(sector_bucket: str | None) -> SectorOverrideFlags:
    """Look up the override row for ``sector_bucket`` (case-insensitive).

    Unknown or empty buckets return an all-default row (with ``sector_label`` echoed when a
    non-empty bucket was supplied) so scoring falls back to the generic F1–F5 rules.
    """
    bucket = (sector_bucket or "").strip().lower()
    if not bucket:
        return SectorOverrideFlags()
    return _SECTOR_OVERRIDE_TABLE.get(bucket, SectorOverrideFlags(sector_label=bucket))

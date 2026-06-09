"""
Downweight IPO roadshow competitive-displacement headlines; modestly boost stake-repricing copy.

Applied only to corporate backers during active S-1 / post-listing seasoning windows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from stocvest.data.ipo_ecosystem_registry import all_ecosystem_definitions
from stocvest.data.market_context_flags import _ecosystem_role

_COMPETITIVE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bthreatens?\b",
        r"\bunder threat\b",
        r"\bdisplaces?\b",
        r"\bdisruption\b",
        r"\bloses? to\b",
        r"\blose market share\b",
        r"\bcompetes? with\b",
        r"\brival\b",
        r"\bdominance\b",
        r"\bversus\b",
        r"\bvs\.?\s+\w+",
        r"\bkills?\b",
        r"\bend of\b",
    )
)

_STAKE_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bstake\b",
        r"\bequity (stake|holding|investment)\b",
        r"\binvestment commitment\b",
        r"\bmark-to-market\b",
        r"\breprice[sd]?\b",
        r"\bvaluation\b",
        r"\bworth \$\d",
        r"\bbillion (stake|investment|commitment)\b",
        r"\bpartnership\b",
        r"\bazure\b",
        r"\baws\b",
        r"\bcloud commitment\b",
    )
)

_COMPETITIVE_MULT = 0.35
_STAKE_MULT = 1.12
_ROADSHOW_DAYS = 120


@dataclass(frozen=True)
class IpoNarrativeAdjustment:
    weight_multiplier: float
    tag: str | None
    entity: str | None


def _roadshow_active(eco, *, as_of: date) -> bool:
    if eco.ipo_date is not None and (as_of - eco.ipo_date).days < 90:
        return True
    if eco.s1_filed_date is not None:
        days_since_s1 = (as_of - eco.s1_filed_date).days
        if 0 <= days_since_s1 <= _ROADSHOW_DAYS:
            return True
    if eco.index_inclusion_window_end is not None and eco.ipo_date is not None:
        if eco.ipo_date <= as_of <= eco.index_inclusion_window_end:
            return True
    return False


def _mentions_entity(blob: str, eco) -> bool:
    entity = eco.trigger_entity.casefold()
    if entity in blob:
        return True
    ticker = (eco.listed_ticker or "").casefold()
    return bool(ticker and ticker in blob)


def classify_ipo_narrative_adjustment(
    symbol: str,
    title: str,
    description: str,
    *,
    as_of: date | None = None,
) -> IpoNarrativeAdjustment:
    """
    Return per-article weight multiplier for headline sentiment blending.

    Competitive IPO narrative on a backer symbol is dampened; stake-repricing copy is nudged up.
    """
    sym = (symbol or "").strip().upper()
    blob = f"{title or ''} {description or ''}".casefold()
    ref_day = as_of or date.today()
    best_mult = 1.0
    best_tag: str | None = None
    best_entity: str | None = None

    for eco in all_ecosystem_definitions():
        if not _roadshow_active(eco, as_of=ref_day):
            continue
        role = _ecosystem_role(sym, eco)
        if role != "corporate_backer":
            continue
        if not _mentions_entity(blob, eco):
            continue

        competitive = any(p.search(blob) for p in _COMPETITIVE_PATTERNS)
        stake = any(p.search(blob) for p in _STAKE_PATTERNS)

        if competitive:
            mult = _COMPETITIVE_MULT
            tag = "ipo_narrative_competitive"
        elif stake:
            mult = _STAKE_MULT
            tag = "ipo_narrative_stake_repricing"
        else:
            continue

        if mult < best_mult or (mult > 1.0 and best_mult == 1.0):
            best_mult = mult
            best_tag = tag
            best_entity = eco.trigger_entity

    return IpoNarrativeAdjustment(
        weight_multiplier=best_mult,
        tag=best_tag,
        entity=best_entity,
    )

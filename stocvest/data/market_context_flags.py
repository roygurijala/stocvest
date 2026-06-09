"""
Market-structure context flags (IPO seasoning, index-inclusion windows, ecosystem exposure).

Advisory only — does not change composite layer math; surfaces honest caveats on responses.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from stocvest.data.ipo_ecosystem_registry import (
    IpoEcosystemDefinition,
    get_ecosystems_for_symbol,
)
from stocvest.data.symbol_universe_eligibility import MIN_LISTED_DAYS, resolve_listed_days
from stocvest.data.ticker_reference import TickerReference

_UNSEASONED_GAP_WARNING = (
    "New listing (under 90 sessions) — gap volume may reflect IPO discovery or index flows, "
    "not organic conviction."
)
_INDEX_WINDOW_WARNING = (
    "Index inclusion window — passive rebalancing may distort volume, sector, and internals reads."
)
_ECOSYSTEM_EXPOSURE_PREFIX = "IPO ecosystem exposure"


def resolve_market_context_flags(
    symbol: str,
    *,
    reference: TickerReference | None = None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """
    Return advisory flags for composite and scanner payloads.

    Keys: ``ipo_unseasoned``, ``index_inclusion_window``, ``ecosystem_entity``,
    ``ecosystem_role``, ``warnings`` (list[str]).
    """
    sym = (symbol or "").strip().upper()
    ref_day = as_of or date.today()
    warnings: list[str] = []
    listed_days = resolve_listed_days(sym, reference, as_of=ref_day)
    ipo_unseasoned = listed_days is not None and listed_days < MIN_LISTED_DAYS

    ecosystems = get_ecosystems_for_symbol(sym)
    ecosystem_entities: list[str] = []
    ecosystem_roles: list[str] = []
    index_inclusion_window = False
    index_inclusion_window_end: str | None = None

    if ipo_unseasoned:
        warnings.append(_UNSEASONED_GAP_WARNING)

    for eco in ecosystems:
        role = _ecosystem_role(sym, eco)
        ecosystem_entities.append(eco.trigger_entity)
        ecosystem_roles.append(role)

        if eco.index_inclusion_window_end is not None and eco.ipo_date is not None:
            if eco.ipo_date <= ref_day <= eco.index_inclusion_window_end:
                index_inclusion_window = True
                index_inclusion_window_end = eco.index_inclusion_window_end.isoformat()
                if _INDEX_WINDOW_WARNING not in warnings:
                    warnings.append(_INDEX_WINDOW_WARNING)

        if role in {"corporate_backer", "etf_or_cef_holder", "theme_peer"}:
            note = eco.stake_notes.get(sym)
            if note:
                line = f"{_ECOSYSTEM_EXPOSURE_PREFIX} ({eco.trigger_entity}): {note}"
            else:
                line = f"{_ECOSYSTEM_EXPOSURE_PREFIX}: {eco.trigger_entity} {role.replace('_', ' ')}"
            if line not in warnings:
                warnings.append(line)

        if eco.listed_ticker is None and eco.s1_filed_date is not None:
            days_since_s1 = (ref_day - eco.s1_filed_date).days
            if 0 <= days_since_s1 <= 120 and role == "corporate_backer":
                roadshow = (
                    f"{eco.trigger_entity} IPO roadshow window — news may mix stake repricing "
                    "with competitive-displacement narratives."
                )
                if roadshow not in warnings:
                    warnings.append(roadshow)

    return {
        "ipo_unseasoned": ipo_unseasoned,
        "listed_days": listed_days,
        "index_inclusion_window": index_inclusion_window,
        "index_inclusion_window_end": index_inclusion_window_end,
        "ecosystem_entities": ecosystem_entities,
        "ecosystem_roles": ecosystem_roles,
        "ecosystem_entity": ecosystem_entities[0] if ecosystem_entities else None,
        "ecosystem_role": ecosystem_roles[0] if ecosystem_roles else None,
        "warnings": warnings,
    }


def _ecosystem_role(sym: str, eco: IpoEcosystemDefinition) -> str:
    if sym == (eco.listed_ticker or "").upper():
        return "listed_issuer"
    if sym in {s.upper() for s in eco.corporate_backers}:
        return "corporate_backer"
    if sym in {s.upper() for s in eco.etf_holders}:
        return "etf_or_cef_holder"
    return "theme_peer"


def gap_item_market_context_warning(flags: dict[str, Any]) -> str | None:
    """Single scanner-friendly warning line from :func:`resolve_market_context_flags`."""
    warns = flags.get("warnings")
    if not isinstance(warns, list) or not warns:
        return None
    return str(warns[0])


def ecosystem_peer_symbols(eco: IpoEcosystemDefinition) -> tuple[str, ...]:
    return eco.all_tradable_peers()

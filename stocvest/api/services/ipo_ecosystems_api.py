"""Scanner IPO ecosystem exposure payload (curated, no investment advice)."""

from __future__ import annotations

from typing import Any

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.data.ipo_ecosystem_registry import IpoEcosystemDefinition, all_ecosystem_definitions


def _serialize_ecosystem(eco: IpoEcosystemDefinition) -> dict[str, Any]:
    return {
        "trigger_entity": eco.trigger_entity,
        "registry_key": eco.registry_key,
        "sector_name": eco.sector_name,
        "listed_ticker": eco.listed_ticker,
        "ipo_date": eco.ipo_date.isoformat() if eco.ipo_date else None,
        "s1_filed_date": eco.s1_filed_date.isoformat() if eco.s1_filed_date else None,
        "target_ipo_window": eco.target_ipo_window,
        "index_inclusion_window_end": (
            eco.index_inclusion_window_end.isoformat() if eco.index_inclusion_window_end else None
        ),
        "corporate_backers": list(eco.corporate_backers),
        "etf_holders": list(eco.etf_holders),
        "theme_peers": list(eco.theme_peers),
        "tradable_peers": list(eco.all_tradable_peers()),
        "stake_notes": dict(eco.stake_notes),
    }


def build_ipo_ecosystems_payload() -> dict[str, Any]:
    ecosystems = [_serialize_ecosystem(eco) for eco in all_ecosystem_definitions()]
    return {
        "ecosystems": ecosystems,
        "as_of_note": "Stake weights and marks are approximate; refresh after issuer filings and fund reports.",
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }

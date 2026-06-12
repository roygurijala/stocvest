"""
Curated IPO / pre-IPO ecosystem metadata for laggard peers, market-context flags, and desk copy.

Stake sizes and ETF weights move with inflows and marks — notes use approximate, sourced
ranges with an as-of anchor (2026-06-08). Refresh after each issuer files an S-1 or
holdings report.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

EcosystemEntity = Literal["SpaceX", "Anthropic", "OpenAI"]

# Post-IPO / expected listing tickers (update when SEC sets final symbol).
SPACEX_LISTED_TICKER = "SPCX"


@dataclass(frozen=True)
class IpoEcosystemDefinition:
    trigger_entity: EcosystemEntity
    sector_name: str
    registry_key: str
    corporate_backers: tuple[str, ...]
    etf_holders: tuple[str, ...]
    theme_peers: tuple[str, ...]
    stake_notes: dict[str, str]
    ipo_date: date | None = None
    listed_ticker: str | None = None
    s1_filed_date: date | None = None
    target_ipo_window: str | None = None
    index_inclusion_window_end: date | None = None
    ipo_offer_price: float | None = None

    def all_tradable_peers(self) -> tuple[str, ...]:
        return tuple(
            dict.fromkeys(
                [*self.corporate_backers, *self.etf_holders, *self.theme_peers]
            )
        )


# Morningstar fund marks (2026-05-29): XOVR 14.4%, NASA 6.5%, RONB 1.9% SpaceX weight.
# DXYZ ~16% SpaceX (largest CEF position; also holds OpenAI/Anthropic pre-IPO).
# Alphabet ~7% Class A stake per SpaceX prospectus coverage (CNBC, May 2026).
# EchoStar (SATS) holds direct SpaceX equity from spectrum deal — NAV-sensitive proxy.
SPACEX_ECOSYSTEM = IpoEcosystemDefinition(
    trigger_entity="SpaceX",
    sector_name="SpaceX ecosystem",
    registry_key="spacex_ecosystem",
    listed_ticker=SPACEX_LISTED_TICKER,
    ipo_date=date(2026, 6, 12),
    ipo_offer_price=135.0,
    index_inclusion_window_end=date(2026, 7, 17),
    target_ipo_window="Nasdaq listing targeted June 2026",
    corporate_backers=("GOOGL", "SATS"),
    etf_holders=("XOVR", "NASA", "DXYZ", "RONB", "UFO"),
    theme_peers=("RKLB", "ASTS", "LMT", "BA", "PL", "IRDM"),
    stake_notes={
        "GOOGL": "~7% Class A stake (2015 investment; mark-to-market on IPO)",
        "SATS": "Direct SpaceX equity from spectrum deal — holding-company / NAV proxy",
        "XOVR": "~14% SpaceX weight (ERShares crossover ETF; dilutes with inflows)",
        "NASA": "~6.5% SpaceX weight (Tema Space Innovators ETF)",
        "DXYZ": "~16% SpaceX via SPV (closed-end fund; premium/discount risk)",
        "RONB": "~2% SpaceX weight (Baron First Principles ETF)",
        "UFO": "Procure Space ETF — space infrastructure basket; SpaceX exposure post-IPO",
    },
)

# Anthropic S-1 confidentially filed 2026-06-01. Series H $965B valuation (May 2026).
# Amazon largest committed capital; Alphabet ~14% stake before incremental rounds.
ANTHROPIC_ECOSYSTEM = IpoEcosystemDefinition(
    trigger_entity="Anthropic",
    sector_name="Anthropic ecosystem",
    registry_key="anthropic_ecosystem",
    s1_filed_date=date(2026, 6, 1),
    target_ipo_window="IPO option after SEC review; market targets Q4 2026",
    corporate_backers=("AMZN", "GOOGL", "NVDA", "MSFT"),
    etf_holders=("DXYZ",),
    theme_peers=("SNOW", "CRM", "PLTR"),
    stake_notes={
        "AMZN": "Largest investor; up to ~$33B committed incl. milestone tranches + Bedrock/AWS",
        "GOOGL": "~14% stake reported; up to ~$40B further commitment + Vertex distribution",
        "NVDA": "Up to $10B strategic round (Nov 2025); co-design partnership",
        "MSFT": "Up to $5B + Anthropic $30B Azure compute commitment; Foundry distribution",
        "DXYZ": "Pre-IPO Anthropic exposure via closed-end fund (weight varies)",
    },
)

# OpenAI confidential S-1 filed ~2026-06-08. Oct 2025 restructuring: Microsoft ~27% economic stake.
# Mar 2026 round: Amazon $50B committed ($15B initial), Nvidia $30B, SoftBank $30B (private).
OPENAI_ECOSYSTEM = IpoEcosystemDefinition(
    trigger_entity="OpenAI",
    sector_name="OpenAI ecosystem",
    registry_key="openai_ecosystem",
    s1_filed_date=date(2026, 6, 8),
    target_ipo_window="Confidential S-1; bankers target Q4 2026",
    corporate_backers=("MSFT", "NVDA", "AMZN"),
    etf_holders=("DXYZ",),
    theme_peers=("ORCL", "CRWV", "AMD"),
    stake_notes={
        "MSFT": "~27% economic stake post-restructure; Azure API exclusivity to 2032",
        "NVDA": "$30B equity commitment (Mar 2026 round); primary compute supplier",
        "AMZN": "Up to $50B committed ($15B initial); AWS Trainium capacity + cloud spend",
        "DXYZ": "Pre-IPO OpenAI exposure via closed-end fund (weight varies)",
        "ORCL": "Stargate / cloud infrastructure partner (indirect AI capex read-through)",
        "CRWV": "CoreWeave — OpenAI-linked GPU infrastructure demand proxy",
    },
)

_ECOSYSTEMS: dict[EcosystemEntity, IpoEcosystemDefinition] = {
    "SpaceX": SPACEX_ECOSYSTEM,
    "Anthropic": ANTHROPIC_ECOSYSTEM,
    "OpenAI": OPENAI_ECOSYSTEM,
}

_BY_REGISTRY_KEY: dict[str, IpoEcosystemDefinition] = {
    d.registry_key: d for d in _ECOSYSTEMS.values()
}

_SYMBOL_TO_ECOSYSTEMS: dict[str, tuple[IpoEcosystemDefinition, ...]] = {}


def _register_symbol_ecosystem(sym: str, eco: IpoEcosystemDefinition) -> None:
    key = sym.upper()
    existing = _SYMBOL_TO_ECOSYSTEMS.get(key, ())
    if eco not in existing:
        _SYMBOL_TO_ECOSYSTEMS[key] = (*existing, eco)


for _eco in _ECOSYSTEMS.values():
    if _eco.listed_ticker:
        _register_symbol_ecosystem(_eco.listed_ticker, _eco)
    for _sym in _eco.all_tradable_peers():
        _register_symbol_ecosystem(_sym, _eco)


def get_ecosystem(entity: str) -> IpoEcosystemDefinition | None:
    key = (entity or "").strip()
    if not key:
        return None
    for name, eco in _ECOSYSTEMS.items():
        if name.casefold() == key.casefold():
            return eco
    return None


def get_ecosystem_by_registry_key(key: str) -> IpoEcosystemDefinition | None:
    return _BY_REGISTRY_KEY.get((key or "").strip())


def get_ecosystems_for_symbol(symbol: str) -> tuple[IpoEcosystemDefinition, ...]:
    return _SYMBOL_TO_ECOSYSTEMS.get((symbol or "").strip().upper(), ())


def get_ecosystem_for_symbol(symbol: str) -> IpoEcosystemDefinition | None:
    """First matching ecosystem (prefer listed issuer match)."""
    sym = (symbol or "").strip().upper()
    matches = get_ecosystems_for_symbol(sym)
    if not matches:
        return None
    for eco in matches:
        if (eco.listed_ticker or "").upper() == sym:
            return eco
    return matches[0]


def all_ecosystem_definitions() -> tuple[IpoEcosystemDefinition, ...]:
    return tuple(_ECOSYSTEMS.values())


def known_recent_ipo_tickers() -> frozenset[str]:
    """Tickers with a known IPO date still inside the default seasoning window."""
    out: set[str] = set()
    for eco in _ECOSYSTEMS.values():
        if eco.listed_ticker:
            out.add(eco.listed_ticker.upper())
    return frozenset(out)

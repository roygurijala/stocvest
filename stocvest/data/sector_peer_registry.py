"""
Static peer groups for laggard intelligence (Layers 1–2).

Design rules (Chunk 2):
  - min_peers_for_signal = 3 for every group (including biotech): keeps a consistent
    bar for "sector is moving" while still workable with 7 liquid biotech names.
  - primary_etf symbols are NEVER listed in peers (avoids circular confirmation).
  - detect_laggard (Chunk 4A) MUST exclude the subject symbol from peer averages.
  - SECTOR groups require ETF confirmation; INDEX/THEME/MACRO/PRE_IPO_PROXY do not.
  - Symbols may appear in multiple groups; use get_all_peer_groups() for multi-group eval.
  - Post-IPO symbols not in the registry are handled by dynamic clusters (Chunk 4B).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

# International ADRs — noisier vs US listings; higher lag threshold in get_lag_threshold().
ADR_SYMBOLS: frozenset[str] = frozenset({"TSM", "ASML"})

_STANDARD_LAG_THRESHOLD_PCT = 1.5
_ADR_LAG_THRESHOLD_PCT = 2.0


class PeerGroupType(str, Enum):
    SECTOR = "sector"
    INDEX = "index"
    THEME = "theme"
    MACRO = "macro"
    PRE_IPO_PROXY = "pre_ipo_proxy"


# Most-specific first when resolving get_peer_group().
_TYPE_SPECIFICITY: tuple[PeerGroupType, ...] = (
    PeerGroupType.SECTOR,
    PeerGroupType.THEME,
    PeerGroupType.INDEX,
    PeerGroupType.MACRO,
    PeerGroupType.PRE_IPO_PROXY,
)

# Tie-break within the same group_type (lower = more specific). Broad buckets rank last.
_REGISTRY_KEY_PRIORITY: dict[str, int] = {
    "semiconductors": 10,
    "biotech": 10,
    "energy": 10,
    "financials_banks": 10,
    "consumer_disc": 10,
    "ev_autos": 10,
    "mega_cap_tech": 90,
    "ai_theme": 20,
    "cloud_infra": 20,
    "cloud_software": 20,
    "qqq_heavy": 30,
    "spy_heavy": 30,
    "rate_sensitive_growth": 40,
    "openai_ecosystem": 10,
    "spacex_adjacent": 10,
    "anthropic_ecosystem": 10,
    "stripe_adjacent": 10,
    "databricks_adjacent": 10,
}


@dataclass(frozen=True)
class SectorPeerGroup:
    sector_name: str
    group_type: PeerGroupType
    primary_etf: str | None
    peers: tuple[str, ...]
    min_peers_for_signal: int
    requires_etf_confirmation: bool
    trigger_entity: str | None = None
    is_international_adr: bool = False
    registry_key: str = ""

    def __post_init__(self) -> None:
        if self.group_type == PeerGroupType.SECTOR and not self.requires_etf_confirmation:
            raise ValueError(f"SECTOR group {self.registry_key!r} must require ETF confirmation")
        if self.group_type != PeerGroupType.SECTOR and self.requires_etf_confirmation:
            raise ValueError(f"Non-SECTOR group {self.registry_key!r} must not require ETF confirmation")
        if self.group_type == PeerGroupType.PRE_IPO_PROXY and self.primary_etf is not None:
            raise ValueError(f"PRE_IPO_PROXY group {self.registry_key!r} must have primary_etf=None")
        etf = (self.primary_etf or "").strip().upper()
        if etf and etf in {p.upper() for p in self.peers}:
            raise ValueError(f"Group {self.registry_key!r}: primary_etf must not appear in peers")


def _g(
    key: str,
    *,
    sector_name: str,
    group_type: PeerGroupType,
    primary_etf: str | None,
    peers: list[str],
    min_peers_for_signal: int = 3,
    requires_etf_confirmation: bool | None = None,
    trigger_entity: str | None = None,
) -> SectorPeerGroup:
    if requires_etf_confirmation is None:
        requires_etf_confirmation = group_type == PeerGroupType.SECTOR
    normalized = tuple(dict.fromkeys(s.strip().upper() for s in peers if s.strip()))
    return SectorPeerGroup(
        sector_name=sector_name,
        group_type=group_type,
        primary_etf=(primary_etf.strip().upper() if primary_etf else None),
        peers=normalized,
        min_peers_for_signal=min_peers_for_signal,
        requires_etf_confirmation=requires_etf_confirmation,
        trigger_entity=trigger_entity,
        registry_key=key,
    )


_PEER_GROUPS: dict[str, SectorPeerGroup] = {
    # ── SECTOR ─────────────────────────────────────────────────────────────
    "semiconductors": _g(
        "semiconductors",
        sector_name="Semiconductors",
        group_type=PeerGroupType.SECTOR,
        primary_etf="SOXX",
        peers=[
            "NVDA",
            "AMD",
            "INTC",
            "AVGO",
            "QCOM",
            "MU",
            "AMAT",
            "KLAC",
            "LRCX",
            "TXN",
            "TSM",
            "ASML",
        ],
    ),
    "mega_cap_tech": _g(
        "mega_cap_tech",
        sector_name="Mega cap tech",
        group_type=PeerGroupType.SECTOR,
        primary_etf="XLK",
        peers=["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA"],
    ),
    "financials_banks": _g(
        "financials_banks",
        sector_name="Large cap banks",
        group_type=PeerGroupType.SECTOR,
        primary_etf="KBE",
        peers=["JPM", "BAC", "WFC", "GS", "MS", "C", "USB"],
    ),
    "energy": _g(
        "energy",
        sector_name="Integrated energy",
        group_type=PeerGroupType.SECTOR,
        primary_etf="XLE",
        peers=["XOM", "CVX", "COP", "EOG", "SLB", "HAL", "PSX"],
    ),
    "biotech": _g(
        "biotech",
        sector_name="Biotech",
        group_type=PeerGroupType.SECTOR,
        primary_etf="XBI",
        peers=["AMGN", "GILD", "BIIB", "REGN", "VRTX", "MRNA", "BNTX"],
    ),
    "consumer_disc": _g(
        "consumer_disc",
        sector_name="Consumer discretionary",
        group_type=PeerGroupType.SECTOR,
        primary_etf="XLY",
        peers=["AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX", "TGT"],
    ),
    "ev_autos": _g(
        "ev_autos",
        sector_name="EV and autos",
        group_type=PeerGroupType.SECTOR,
        primary_etf="DRIV",
        peers=["TSLA", "RIVN", "LCID", "F", "GM", "NIO", "XPEV"],
    ),
    # ── INDEX ──────────────────────────────────────────────────────────────
    "qqq_heavy": _g(
        "qqq_heavy",
        sector_name="QQQ index heavyweights",
        group_type=PeerGroupType.INDEX,
        primary_etf="QQQ",
        peers=["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"],
        requires_etf_confirmation=False,
    ),
    "spy_heavy": _g(
        "spy_heavy",
        sector_name="SPY index heavyweights",
        group_type=PeerGroupType.INDEX,
        primary_etf="SPY",
        peers=["AAPL", "MSFT", "NVDA", "XOM", "JPM", "UNH", "BRK"],
        requires_etf_confirmation=False,
    ),
    # ── THEME ──────────────────────────────────────────────────────────────
    "ai_theme": _g(
        "ai_theme",
        sector_name="AI infrastructure theme",
        group_type=PeerGroupType.THEME,
        primary_etf="SMH",
        peers=["NVDA", "AMD", "MSFT", "AVGO", "META", "SNOW", "CRWD", "MDB"],
        requires_etf_confirmation=False,
    ),
    "cloud_infra": _g(
        "cloud_infra",
        sector_name="Cloud infrastructure",
        group_type=PeerGroupType.THEME,
        primary_etf="IGV",
        peers=["AMZN", "MSFT", "GOOGL", "SNOW", "NET", "DDOG", "NOW", "PANW"],
        requires_etf_confirmation=False,
    ),
    "cloud_software": _g(
        "cloud_software",
        sector_name="Cloud software",
        group_type=PeerGroupType.THEME,
        primary_etf="WCLD",
        peers=["CRM", "SNOW", "DDOG", "NET", "CRWD", "ZS", "MDB", "BILL"],
        requires_etf_confirmation=False,
    ),
    # ── MACRO ──────────────────────────────────────────────────────────────
    "rate_sensitive_growth": _g(
        "rate_sensitive_growth",
        sector_name="Rate-sensitive growth",
        group_type=PeerGroupType.MACRO,
        primary_etf="QQQ",
        peers=["NVDA", "AMD", "MSFT", "SNOW", "CRWD", "MDB", "NET", "DDOG"],
        requires_etf_confirmation=False,
    ),
    # ── PRE-IPO PROXY ──────────────────────────────────────────────────────
    "openai_ecosystem": _g(
        "openai_ecosystem",
        sector_name="OpenAI ecosystem",
        group_type=PeerGroupType.PRE_IPO_PROXY,
        primary_etf=None,
        peers=["MSFT", "NVDA", "AMZN", "GOOGL", "META", "AMD"],
        requires_etf_confirmation=False,
        trigger_entity="OpenAI",
    ),
    "spacex_adjacent": _g(
        "spacex_adjacent",
        sector_name="Space economy",
        group_type=PeerGroupType.PRE_IPO_PROXY,
        primary_etf=None,
        peers=["RKLB", "ASTS", "LMT", "BA", "SPCE", "MNTS", "VSAT"],
        requires_etf_confirmation=False,
        trigger_entity="SpaceX",
    ),
    "anthropic_ecosystem": _g(
        "anthropic_ecosystem",
        sector_name="Anthropic ecosystem",
        group_type=PeerGroupType.PRE_IPO_PROXY,
        primary_etf=None,
        peers=["AMZN", "GOOGL", "NVDA"],
        min_peers_for_signal=2,
        requires_etf_confirmation=False,
        trigger_entity="Anthropic",
    ),
    "stripe_adjacent": _g(
        "stripe_adjacent",
        sector_name="Payments competition",
        group_type=PeerGroupType.PRE_IPO_PROXY,
        primary_etf=None,
        peers=["PYPL", "SQ", "V", "MA", "SHOP", "ADYEN"],
        requires_etf_confirmation=False,
        trigger_entity="Stripe",
    ),
    "databricks_adjacent": _g(
        "databricks_adjacent",
        sector_name="Data platform competition",
        group_type=PeerGroupType.PRE_IPO_PROXY,
        primary_etf=None,
        peers=["SNOW", "DBX", "CRM", "MSFT", "AMZN"],
        requires_etf_confirmation=False,
        trigger_entity="Databricks",
    ),
}

_SYMBOL_TO_GROUPS: dict[str, list[SectorPeerGroup]] = {}
for _group in _PEER_GROUPS.values():
    for _sym in _group.peers:
        _SYMBOL_TO_GROUPS.setdefault(_sym, []).append(_group)

_ETF_SYMBOLS: frozenset[str] = frozenset(
    g.primary_etf for g in _PEER_GROUPS.values() if g.primary_etf
)


def get_peer_group(symbol: str) -> SectorPeerGroup | None:
    """Return the most specific group for a symbol, or None."""
    groups = get_all_peer_groups(symbol)
    return groups[0] if groups else None


def get_all_peer_groups(symbol: str) -> list[SectorPeerGroup]:
    """All groups containing symbol, sorted SECTOR → THEME → INDEX → MACRO → PRE_IPO_PROXY."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return []
    raw = list(_SYMBOL_TO_GROUPS.get(sym, []))
    order = {t: i for i, t in enumerate(_TYPE_SPECIFICITY)}

    def _sort_key(g: SectorPeerGroup) -> tuple[int, int, str]:
        return (
            order.get(g.group_type, 99),
            _REGISTRY_KEY_PRIORITY.get(g.registry_key, 50),
            g.registry_key,
        )

    return sorted(raw, key=_sort_key)


def get_all_registry_symbols() -> list[str]:
    """All peer symbols and primary ETFs (deduplicated). PRE_IPO groups contribute peers only."""
    out: list[str] = []
    seen: set[str] = set()
    for group in _PEER_GROUPS.values():
        for sym in group.peers:
            su = sym.upper()
            if su not in seen:
                seen.add(su)
                out.append(su)
        if group.primary_etf:
            etf = group.primary_etf.upper()
            if etf not in seen:
                seen.add(etf)
                out.append(etf)
    return out


def is_etf(symbol: str) -> bool:
    """True if symbol is any group's primary_etf."""
    return (symbol or "").strip().upper() in _ETF_SYMBOLS


def get_pre_ipo_proxy_groups() -> list[SectorPeerGroup]:
    """All PRE_IPO_PROXY groups (for news activation in Chunk 6/9)."""
    return [g for g in _PEER_GROUPS.values() if g.group_type == PeerGroupType.PRE_IPO_PROXY]


def get_group_by_trigger_entity(entity: str) -> SectorPeerGroup | None:
    """Match pre-IPO proxy group by trigger_entity (case-insensitive)."""
    needle = (entity or "").strip().casefold()
    if not needle:
        return None
    for group in _PEER_GROUPS.values():
        te = group.trigger_entity
        if te and te.casefold() == needle:
            return group
    return None


def get_lag_threshold(group: SectorPeerGroup, symbol: str) -> float:
    """
    Minimum lag % behind peer average required for a laggard signal.

    Standard: 1.5%. ADR symbols (TSM, ASML): 2.0% — noisier cross-listing.
    """
    _ = group  # group may gain type-specific thresholds later
    if (symbol or "").strip().upper() in ADR_SYMBOLS:
        return _ADR_LAG_THRESHOLD_PCT
    return _STANDARD_LAG_THRESHOLD_PCT


def registry_group_keys() -> tuple[str, ...]:
    """Stable registry keys (for tests and ops)."""
    return tuple(_PEER_GROUPS.keys())

"""
Cheap full-market funnel (Steps 2–3) before expensive composite scoring.

Reuses gap-intelligence gates from :mod:`stocvest.signals.day_trading_scanner` so
dashboard gap desk and Opportunity Desk stay aligned. See
``docs/OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from stocvest.data.models import Snapshot
from stocvest.signals.day_trading_scanner import (
    PremarketGapCandidate,
    dynamic_gap_candidates_from_snapshots_with_stats,
)


@dataclass(frozen=True)
class OpportunityDeskFunnelConfig:
    """Tunable funnel limits — defaults match gap intelligence + planned desk UX."""

    min_abs_gap_percent: float = 2.0
    min_day_volume: float = 500_000.0
    min_trade_price: float = 5.0
    min_prev_day_volume: float = 1_000_000.0
    movers_radar_limit: int = 50
    survivor_limit: int = 150
    discovery_display_limit: int = 15
    gap_intel_display_limit: int = 20


@dataclass(frozen=True)
class FunnelMover:
    """One row after Step 2–3 (arithmetic only)."""

    symbol: str
    gap_percent: float
    direction: Literal["up", "down"]
    rank_score: float
    day_volume: float
    session_price: float


@dataclass(frozen=True)
class OpportunityDeskFunnelResult:
    movers: tuple[FunnelMover, ...]
    eligible_symbol_count: int
    scanned_snapshot_count: int

    @property
    def discovery_symbols(self) -> tuple[str, ...]:
        n = OpportunityDeskFunnelConfig().discovery_display_limit
        return tuple(m.symbol for m in self.movers[:n])

    @property
    def movers_radar_symbols(self) -> tuple[str, ...]:
        n = OpportunityDeskFunnelConfig().movers_radar_limit
        return tuple(m.symbol for m in self.movers[:n])


@dataclass(frozen=True)
class DeskSnapshotDiff:
    """Lifecycle diff between two desk generations (top-N symbol lists)."""

    added: tuple[str, ...]
    dropped: tuple[str, ...]
    retained: tuple[str, ...]


def _candidate_to_mover(c: PremarketGapCandidate) -> FunnelMover:
    direction: Literal["up", "down"] = "up" if c.direction == "up" else "down"
    return FunnelMover(
        symbol=c.symbol.strip().upper(),
        gap_percent=c.gap_percent,
        direction=direction,
        rank_score=c.rank_score,
        day_volume=c.day_volume,
        session_price=c.premarket_price,
    )


def run_snapshot_funnel(
    snapshots: Iterable[Snapshot],
    config: OpportunityDeskFunnelConfig | None = None,
    *,
    recent_split_symbols: frozenset[str] | None = None,
    frequent_reverse_split_symbols: frozenset[str] | None = None,
) -> OpportunityDeskFunnelResult:
    """
    Rank movers from a US equities snapshot feed using gap-intelligence gates.

    ``scanned_snapshot_count`` is the number of snapshot rows supplied (feed breadth).
    ``eligible_symbol_count`` is how many passed all liquidity/price/gap gates before
    the survivor cap — this is the number to show users as "scanned eligible."
    """
    cfg = config or OpportunityDeskFunnelConfig()
    snap_list = list(snapshots)
    scan = dynamic_gap_candidates_from_snapshots_with_stats(
        snap_list,
        limit=max(0, cfg.survivor_limit),
        min_abs_gap_percent=cfg.min_abs_gap_percent,
        min_day_volume=cfg.min_day_volume,
        min_trade_price=cfg.min_trade_price,
        recent_split_symbols=recent_split_symbols,
        frequent_reverse_split_symbols=frequent_reverse_split_symbols,
    )
    movers = tuple(_candidate_to_mover(c) for c in scan.candidates)
    return OpportunityDeskFunnelResult(
        movers=movers,
        eligible_symbol_count=scan.eligible_symbol_count,
        scanned_snapshot_count=len(snap_list),
    )


def diff_desk_snapshots(
    previous_symbols: Iterable[str],
    current_symbols: Iterable[str],
) -> DeskSnapshotDiff:
    """
    Compare two ordered symbol lists (e.g. discovery top-15) for lifecycle UI.

    Symbols are normalized to uppercase; order in ``current_symbols`` is preserved
    for ``retained``.
    """
    prev = {str(s).strip().upper() for s in previous_symbols if str(s).strip()}
    cur_list = [str(s).strip().upper() for s in current_symbols if str(s).strip()]
    cur_set = set(cur_list)
    added = tuple(s for s in cur_list if s not in prev)
    dropped = tuple(sorted(prev - cur_set))
    retained = tuple(s for s in cur_list if s in prev)
    return DeskSnapshotDiff(added=added, dropped=dropped, retained=retained)

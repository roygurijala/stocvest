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

from stocvest.data.symbol_universe_eligibility import (
    listing_age_exclusion_reason,
    snapshot_universe_exclusion_reason,
)
from stocvest.data.models import Snapshot
from stocvest.signals.day_trading_scanner import (
    PremarketGapCandidate,
    dynamic_gap_candidates_from_snapshots_with_stats,
    is_corporate_action_session_move,
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
    adaptive_survivor_limit: bool = True
    elevated_survivor_limit: int = 220
    elevated_breadth_trigger: int = 180
    discovery_display_limit: int = 15
    gap_intel_display_limit: int = 20


@dataclass(frozen=True)
class FunnelRejectionSample:
    symbol: str
    reason: str


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
    survivor_limit_used: int
    rejection_reason_counts: dict[str, int]
    rejected_samples: tuple[FunnelRejectionSample, ...]

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


def _resolve_survivor_limit(
    cfg: OpportunityDeskFunnelConfig,
    *,
    eligible_symbol_count: int,
) -> int:
    base = max(0, cfg.survivor_limit)
    if not cfg.adaptive_survivor_limit:
        return base
    trigger = max(0, cfg.elevated_breadth_trigger)
    elevated = max(base, cfg.elevated_survivor_limit)
    if eligible_symbol_count >= trigger:
        return elevated
    return base


def _rejection_reason_for_snapshot(
    snap: Snapshot,
    *,
    cfg: OpportunityDeskFunnelConfig,
    recent_split_symbols: frozenset[str] | None,
    frequent_reverse_split_symbols: frozenset[str] | None,
) -> str | None:
    prev = snap.prev_close
    if prev is None or prev <= 0:
        return "invalid_prev_close"
    last = snap.last_trade_price
    o = snap.day_open
    if last is not None and last > 0:
        price = float(last)
    elif o is not None and o > 0:
        price = float(o)
    else:
        return "missing_session_price"
    universe_reason = snapshot_universe_exclusion_reason(
        snap.symbol,
        snap,
        min_trade_price=cfg.min_trade_price,
        recent_split_symbols=recent_split_symbols,
        frequent_reverse_split_symbols=frequent_reverse_split_symbols,
    )
    if universe_reason:
        return universe_reason
    listing_reason = listing_age_exclusion_reason(snap.symbol, None)
    if listing_reason:
        return listing_reason
    vol = float(snap.day_volume or 0.0)
    if vol < cfg.min_day_volume:
        return f"day_volume_below_{int(cfg.min_day_volume):d}"
    prev_vol = float(snap.prev_day_volume or 0.0)
    if prev_vol > 0 and prev_vol < cfg.min_prev_day_volume:
        return f"prev_day_volume_below_{int(cfg.min_prev_day_volume):d}"
    gap_pct = (price - float(prev)) / float(prev) * 100.0
    if is_corporate_action_session_move(
        float(prev),
        price,
        gap_pct,
        symbol=snap.symbol,
        recent_split_symbols=recent_split_symbols,
    ):
        return "corporate_action_artifact"
    if abs(gap_pct) < cfg.min_abs_gap_percent:
        return f"gap_below_{cfg.min_abs_gap_percent:.1f}pct"
    return None


def _build_rejection_summary(
    snapshots: Iterable[Snapshot],
    *,
    cfg: OpportunityDeskFunnelConfig,
    recent_split_symbols: frozenset[str] | None,
    frequent_reverse_split_symbols: frozenset[str] | None,
    max_samples: int = 25,
) -> tuple[dict[str, int], tuple[FunnelRejectionSample, ...]]:
    counts: dict[str, int] = {}
    samples: list[FunnelRejectionSample] = []
    for snap in snapshots:
        reason = _rejection_reason_for_snapshot(
            snap,
            cfg=cfg,
            recent_split_symbols=recent_split_symbols,
            frequent_reverse_split_symbols=frequent_reverse_split_symbols,
        )
        if reason is None:
            continue
        counts[reason] = counts.get(reason, 0) + 1
        if len(samples) < max_samples:
            sym = str(snap.symbol or "").strip().upper()
            if sym:
                samples.append(FunnelRejectionSample(symbol=sym, reason=reason))
    ordered_counts = dict(sorted(counts.items(), key=lambda kv: kv[1], reverse=True))
    return ordered_counts, tuple(samples)


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
    coarse_limit = max(0, cfg.survivor_limit)
    if cfg.adaptive_survivor_limit:
        coarse_limit = max(coarse_limit, max(0, cfg.elevated_survivor_limit))
    scan = dynamic_gap_candidates_from_snapshots_with_stats(
        snap_list,
        limit=coarse_limit,
        min_abs_gap_percent=cfg.min_abs_gap_percent,
        min_day_volume=cfg.min_day_volume,
        min_trade_price=cfg.min_trade_price,
        recent_split_symbols=recent_split_symbols,
        frequent_reverse_split_symbols=frequent_reverse_split_symbols,
    )
    survivor_limit_used = _resolve_survivor_limit(
        cfg,
        eligible_symbol_count=scan.eligible_symbol_count,
    )
    movers = tuple(_candidate_to_mover(c) for c in scan.candidates[:survivor_limit_used])
    rejection_reason_counts, rejected_samples = _build_rejection_summary(
        snap_list,
        cfg=cfg,
        recent_split_symbols=recent_split_symbols,
        frequent_reverse_split_symbols=frequent_reverse_split_symbols,
    )
    return OpportunityDeskFunnelResult(
        movers=movers,
        eligible_symbol_count=scan.eligible_symbol_count,
        scanned_snapshot_count=len(snap_list),
        survivor_limit_used=survivor_limit_used,
        rejection_reason_counts=rejection_reason_counts,
        rejected_samples=rejected_samples,
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

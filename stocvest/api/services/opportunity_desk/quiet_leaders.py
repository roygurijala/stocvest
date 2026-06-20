"""
Low-velocity / high-structure leaders (Quiet Leaders) — parallel to gap movers funnel.

Surfaces names with strong swing technicals before they rank as session movers.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Literal

from stocvest.api.services.opportunity_desk.discovery_row import discovery_row_from_mover
from stocvest.api.services.opportunity_desk.funnel import FunnelMover, OpportunityDeskFunnelConfig
from stocvest.config.parameter_store import ParameterStore
from stocvest.data.models import Snapshot, Timeframe
from stocvest.data.symbol_universe_eligibility import snapshot_universe_exclusion_reason
from stocvest.signals.session_price_guard import session_gap_percent
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer, SwingTechnicalLayerResult
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

DeskMode = Literal["swing", "day"]


@dataclass(frozen=True)
class QuietLeadersConfig:
    """Tunable quiet-leader screen — defaults match product brief."""

    max_abs_gap_percent: float = 2.0
    min_day_volume: float = 500_000.0
    min_trade_price: float = 5.0
    min_prev_day_volume: float = 1_000_000.0
    exclude_top_movers: int = 50
    candidate_cap: int = 100
    min_technical_score: int = 58
    rsi_min: float = 55.0
    rsi_max: float = 70.0
    display_limit: int = 8
    composite_limit: int = 8
    composite_concurrency: int = 3
    daily_bars_lookback: int = 220


def _session_gap_percent(snap: Snapshot) -> float | None:
    # Delegates to the shared Signal Math contract helper (single source of truth).
    return session_gap_percent(
        snap.prev_close, snap.last_trade_price, snap.day_open, symbol=snap.symbol
    )


def select_quiet_leader_snapshots(
    snapshots: list[Snapshot],
    *,
    exclude_symbols: set[str],
    config: QuietLeadersConfig | None = None,
    recent_split_symbols: frozenset[str] | None = None,
    frequent_reverse_split_symbols: frozenset[str] | None = None,
) -> list[tuple[Snapshot, float]]:
    """Liquid names with |gap| below mover threshold, excluding top session movers."""
    cfg = config or QuietLeadersConfig()
    scored: list[tuple[float, Snapshot, float]] = []
    for snap in snapshots:
        sym = snap.symbol.strip().upper()
        if not sym or sym in exclude_symbols:
            continue
        universe_reason = snapshot_universe_exclusion_reason(
            sym,
            snap,
            min_trade_price=cfg.min_trade_price,
            recent_split_symbols=recent_split_symbols,
            frequent_reverse_split_symbols=frequent_reverse_split_symbols,
        )
        if universe_reason:
            continue
        prev = snap.prev_close
        if prev is None or prev <= 0:
            continue
        last = snap.last_trade_price
        o = snap.day_open
        if last is not None and last > 0:
            price = float(last)
        elif o is not None and o > 0:
            price = float(o)
        else:
            continue
        vol = float(snap.day_volume or 0.0)
        if vol < cfg.min_day_volume:
            continue
        gap_pct = _session_gap_percent(snap)
        if gap_pct is None or abs(gap_pct) >= cfg.max_abs_gap_percent:
            continue
        prev_vol = snap.prev_day_volume
        adv = float(prev_vol or vol or 0.0)
        scored.append((adv, snap, gap_pct))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [(s, g) for _, s, g in scored[: max(0, cfg.candidate_cap)]]


def passes_quiet_leader_technical(
    result: SwingTechnicalLayerResult,
    *,
    last_price: float,
    config: QuietLeadersConfig | None = None,
) -> bool:
    cfg = config or QuietLeadersConfig()
    if result.status != "available" or result.score is None:
        return False
    if result.score < cfg.min_technical_score:
        return False
    if result.verdict != "bullish":
        return False
    rsi = result.daily_rsi
    if rsi is None or rsi < cfg.rsi_min or rsi > cfg.rsi_max:
        return False
    if result.sma50 is None or result.sma200 is None:
        return False
    if last_price <= result.sma50 or last_price <= result.sma200:
        return False
    return True


def quiet_leader_row(
    symbol: str,
    *,
    gap_percent: float,
    technical: SwingTechnicalLayerResult,
    composite: dict[str, Any] | None,
    mode: DeskMode = "swing",
) -> dict[str, Any]:
    direction: Literal["up", "down"] = "up" if gap_percent >= 0 else "down"
    mover = FunnelMover(
        symbol=symbol.strip().upper(),
        gap_percent=gap_percent,
        direction=direction,
        rank_score=float(technical.score or 0),
        day_volume=0.0,
        session_price=0.0,
    )
    row = discovery_row_from_mover(mover, mode=mode, composite=composite)
    row["technical_score"] = technical.score
    row["daily_rsi"] = technical.daily_rsi
    row["quiet_leader"] = True
    row["why_line"] = (
        f"Under the surface · RSI {technical.daily_rsi:.0f}"
        if technical.daily_rsi is not None
        else "Under the surface · strong swing structure"
    )
    if technical.score is not None:
        row["why_line"] += f" · technical {technical.score}"
    return row


async def build_quiet_leaders(
    snapshots: list[Snapshot],
    movers: tuple[FunnelMover, ...],
    *,
    composite_fn: Any,
    funnel_cfg: OpportunityDeskFunnelConfig | None = None,
    config: QuietLeadersConfig | None = None,
    recent_split_symbols: frozenset[str] | None = None,
    frequent_reverse_split_symbols: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Screen low-velocity names, run swing composite on survivors, return display rows.
    ``composite_fn`` is async (symbol) -> composite dict | None (injected from batch).
    """
    cfg = config or QuietLeadersConfig()
    fcfg = funnel_cfg or OpportunityDeskFunnelConfig()
    exclude = {m.symbol for m in movers[: max(0, fcfg.movers_radar_limit)]}
    candidates = select_quiet_leader_snapshots(
        snapshots,
        exclude_symbols=exclude,
        config=cfg,
        recent_split_symbols=recent_split_symbols,
        frequent_reverse_split_symbols=frequent_reverse_split_symbols,
    )
    if not candidates:
        return []

    params = ParameterStore.get_parameters_sync()
    tech_params = params.swing_technical
    analyzer = SwingTechnicalAnalyzer()
    settings = get_settings()

    screened: list[tuple[str, float, SwingTechnicalLayerResult]] = []

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        sem = asyncio.Semaphore(8)

        async def one(snap: Snapshot, gap_pct: float) -> None:
            sym = snap.symbol.strip().upper()
            async with sem:
                try:
                    bars = await client.get_bars(sym, Timeframe.DAY_1, limit=cfg.daily_bars_lookback)
                except Exception:
                    return
            if len(bars) < 60:
                return
            bars_sorted = sorted(bars, key=lambda b: b.timestamp)
            last_price = float(bars_sorted[-1].close)
            result = analyzer.analyze(sym, bars_sorted, snap, tech_params)
            if passes_quiet_leader_technical(result, last_price=last_price, config=cfg):
                screened.append((sym, gap_pct, result))

        await asyncio.gather(*[one(s, g) for s, g in candidates])

    screened.sort(key=lambda x: float(x[2].score or 0), reverse=True)
    targets = screened[: max(0, cfg.composite_limit)]

    if not targets:
        return []

    comp_sem = asyncio.Semaphore(max(1, cfg.composite_concurrency))
    rows: list[dict[str, Any]] = []

    async def with_composite(item: tuple[str, float, SwingTechnicalLayerResult]) -> dict[str, Any]:
        sym, gap_pct, technical = item
        async with comp_sem:
            composite = await composite_fn(sym)
        return quiet_leader_row(sym, gap_percent=gap_pct, technical=technical, composite=composite)

    built = await asyncio.gather(*[with_composite(t) for t in targets])
    rows = list(built)
    rows.sort(
        key=lambda r: (
            float(r.get("alignment_ratio") or 0),
            float(r.get("technical_score") or 0),
        ),
        reverse=True,
    )
    return rows[: max(0, cfg.display_limit)]


def mover_exclude_set(movers: tuple[FunnelMover, ...], *, limit: int = 50) -> set[str]:
    return {m.symbol for m in movers[: max(0, limit)]}

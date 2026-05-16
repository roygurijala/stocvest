"""Per-symbol scanner evaluation traces — gate-level reasons a symbol did not qualify."""

from __future__ import annotations

from typing import Any

from stocvest.data.models import Bar, Timeframe
from stocvest.signals.day_trading_scanner import (
    IntradaySetupScanner,
    SymbolLiquidityContext,
    _LIQUID_MIN_ADV,
    _MIN_SESSION_VOL_FALLBACK,
    _MIN_TRADE_PRICE,
    _REGULAR_SESSION_MINUTES,
    _minutes_since_regular_open_et,
)
from stocvest.signals.daily_bar_scanner import DailyBarScanner


def _trace_row(
    *,
    symbol: str,
    desk: str,
    gate: str,
    detail: str,
    score: float | None = None,
    min_score: float | None = None,
    margin_pct: float | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "symbol": symbol.strip().upper(),
        "desk": desk,
        "gate": gate,
        "detail": detail,
        "outcome": "did_not_qualify",
    }
    if score is not None:
        row["score"] = round(float(score), 4)
    if min_score is not None:
        row["min_score"] = round(float(min_score), 4)
    if margin_pct is not None:
        row["margin_pct"] = round(float(margin_pct), 1)
    return row


def diagnose_intraday_early_gates(
    symbol: str,
    bars: list[Bar],
    liq: SymbolLiquidityContext | None,
) -> dict[str, Any] | None:
    """Return a trace when the symbol fails before a score is produced."""
    sym = symbol.strip().upper()
    if len(bars) < 10:
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="insufficient_bars",
            detail=f"Needs at least 10 one-minute bars; have {len(bars)}",
        )
    if any(bar.symbol != sym for bar in bars):
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="invalid_bars",
            detail="Bar symbol mismatch in payload",
        )
    if any(bar.timeframe != Timeframe.MIN_1 for bar in bars):
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="invalid_timeframe",
            detail="Day desk expects 1-minute bars",
        )

    latest = bars[-1]
    adv = liq.avg_daily_volume if liq and liq.avg_daily_volume is not None else None
    ref_price = float(liq.last_price) if liq and liq.last_price is not None and liq.last_price > 0 else float(latest.close)

    if liq is not None and adv is not None and adv < _LIQUID_MIN_ADV:
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="liquidity",
            detail=f"Average daily volume below {_LIQUID_MIN_ADV:,.0f} share minimum",
        )
    if ref_price < _MIN_TRADE_PRICE:
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="min_price",
            detail=f"Reference price ${ref_price:.2f} below ${_MIN_TRADE_PRICE:.2f} floor",
        )

    session_vol = sum(float(b.volume) for b in bars)
    if adv is not None:
        mins = _minutes_since_regular_open_et(latest.timestamp)
        expected_session = adv * (mins / _REGULAR_SESSION_MINUTES)
        if session_vol + 1e-9 < expected_session:
            shortfall = max(0.0, (1.0 - session_vol / expected_session) * 100.0) if expected_session > 0 else 100.0
            return _trace_row(
                symbol=sym,
                desk="day",
                gate="session_rvol",
                detail=f"Session volume {shortfall:.0f}% below expected intraday pace",
                margin_pct=shortfall,
            )
    elif session_vol < _MIN_SESSION_VOL_FALLBACK:
        shortfall = max(0.0, (1.0 - session_vol / _MIN_SESSION_VOL_FALLBACK) * 100.0)
        return _trace_row(
            symbol=sym,
            desk="day",
            gate="session_volume",
            detail=f"Session volume {shortfall:.0f}% below fallback minimum",
            margin_pct=shortfall,
        )

    return _trace_row(
        symbol=sym,
        desk="day",
        gate="no_triggers",
        detail="No intraday setup triggers fired on this scan",
    )


def build_intraday_evaluation_traces(
    bars_by_symbol: dict[str, list[Bar]],
    *,
    liquidity_by_symbol: dict[str, SymbolLiquidityContext] | None,
    min_score: float,
    exclude_symbols: set[str],
    limit: int = 20,
) -> list[dict[str, Any]]:
    liq_map = liquidity_by_symbol or {}
    probe_scanner = IntradaySetupScanner(min_score=0.0)
    traces: list[dict[str, Any]] = []
    for symbol, bars in bars_by_symbol.items():
        sym = symbol.strip().upper()
        if not sym or sym in exclude_symbols:
            continue
        liq = liq_map.get(sym)
        probe = probe_scanner._scan_symbol(sym, bars, liq)
        if probe is not None and probe.score >= min_score:
            continue
        if probe is not None:
            gap = ((min_score - probe.score) / min_score * 100.0) if min_score > 0 else 0.0
            traces.append(
                _trace_row(
                    symbol=sym,
                    desk="day",
                    gate="score_floor",
                    detail=(
                        f"Best setup score {probe.score:.2f} is below the {min_score:.2f} minimum "
                        f"({gap:.0f}% short)"
                    ),
                    score=probe.score,
                    min_score=min_score,
                    margin_pct=gap,
                )
            )
            continue
        early = diagnose_intraday_early_gates(sym, bars, liq)
        if early:
            traces.append(early)

    def sort_key(row: dict[str, Any]) -> tuple[int, float]:
        gate = str(row.get("gate", ""))
        if gate == "score_floor":
            return (0, -float(row.get("score") or 0))
        margin = row.get("margin_pct")
        if isinstance(margin, (int, float)):
            return (1, float(margin))
        return (2, 0.0)

    traces.sort(key=sort_key)
    return traces[: max(0, limit)]


def build_swing_evaluation_traces(
    bars_by_symbol: dict[str, list[Bar]],
    *,
    liquidity_by_symbol: dict[str, SymbolLiquidityContext] | None,
    min_score: float,
    min_bars: int,
    exclude_symbols: set[str],
    limit: int = 20,
) -> list[dict[str, Any]]:
    liq_map = liquidity_by_symbol or {}
    probe_scanner = DailyBarScanner(min_score=0.0, min_bars=min_bars)
    traces: list[dict[str, Any]] = []
    for symbol, bars in bars_by_symbol.items():
        sym = symbol.strip().upper()
        if not sym or sym in exclude_symbols:
            continue
        if len(bars) < min_bars:
            traces.append(
                _trace_row(
                    symbol=sym,
                    desk="swing",
                    gate="insufficient_history",
                    detail=f"Needs {min_bars} daily bars for swing context; have {len(bars)}",
                )
            )
            continue
        if any(b.symbol.upper() != sym for b in bars):
            continue
        if any(b.timeframe != Timeframe.DAY_1 for b in bars):
            continue
        bars_sorted = sorted(bars, key=lambda b: b.timestamp)
        liq = liq_map.get(sym)
        probe = probe_scanner._scan_symbol(sym, bars_sorted, liq)
        if probe is not None and probe.score >= min_score:
            continue
        if probe is not None:
            gap = ((min_score - probe.score) / min_score * 100.0) if min_score > 0 else 0.0
            traces.append(
                _trace_row(
                    symbol=sym,
                    desk="swing",
                    gate="score_floor",
                    detail=(
                        f"Best swing score {probe.score:.2f} is below the {min_score:.2f} minimum "
                        f"({gap:.0f}% short)"
                    ),
                    score=probe.score,
                    min_score=min_score,
                    margin_pct=gap,
                )
            )
            continue
        traces.append(
            _trace_row(
                symbol=sym,
                desk="swing",
                gate="no_triggers",
                detail="No swing setup triggers fired on this scan",
            )
        )

    traces.sort(
        key=lambda row: (
            0 if row.get("gate") == "score_floor" else 1,
            -float(row.get("score") or 0),
        )
    )
    return traces[: max(0, limit)]

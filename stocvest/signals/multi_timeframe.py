"""
Multi-timeframe context — weekly bias vs daily technical (Chunk 7).

Pure functions; no I/O. Weekly bar = aggregate of last 5 daily sessions.
"""

from __future__ import annotations

from typing import Any

from stocvest.signals.swing_technical_analyzer import _daily_rsi

_WEEKLY_BARS_MIN = 5
_FLAT_THRESHOLD_PCT = 0.3
_RSI_OVERBOUGHT = 70.0
_RSI_OVERSOLD = 30.0


def _bar_value(bar: Any, field: str) -> float | None:
    if isinstance(bar, dict):
        raw = bar.get(field)
    else:
        raw = getattr(bar, field, None)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _bar_timestamp(bar: Any) -> Any:
    if isinstance(bar, dict):
        return bar.get("timestamp")
    return getattr(bar, "timestamp", None)


def _ordered_bars(daily_bars: list[Any]) -> list[Any]:
    return sorted(daily_bars, key=_bar_timestamp)


def _verdict_to_bias(verdict: str) -> str:
    v = (verdict or "neutral").strip().lower()
    if v == "bullish":
        return "bullish"
    if v == "bearish":
        return "bearish"
    return "neutral"


def compute_weekly_bias(daily_bars: list[Any]) -> dict[str, Any]:
    """
    Weekly view from the last five daily bars.

    ``weekly_open`` = open of bar[-5]; ``weekly_close`` = close of bar[-1].
  RSI uses the full available daily close series (14+ sessions when present).
    """
    if len(daily_bars) < _WEEKLY_BARS_MIN:
        return {
            "weekly_bias": "neutral",
            "weekly_change_pct": 0.0,
            "weekly_rsi": 50.0,
            "weekly_note": "Insufficient daily history for weekly context.",
            "bars_used": len(daily_bars),
        }

    ordered = _ordered_bars(daily_bars)
    window = ordered[-_WEEKLY_BARS_MIN:]
    weekly_open = _bar_value(window[0], "open")
    weekly_close = _bar_value(window[-1], "close")
    if weekly_open is None or weekly_close is None or weekly_open == 0:
        return {
            "weekly_bias": "neutral",
            "weekly_change_pct": 0.0,
            "weekly_rsi": 50.0,
            "weekly_note": "Weekly OHLC incomplete on recent sessions.",
            "bars_used": len(window),
        }

    weekly_change_pct = (weekly_close - weekly_open) / weekly_open * 100.0
    closes = [_bar_value(b, "close") for b in ordered]
    closes_f = [c for c in closes if c is not None]
    rsi_raw = _daily_rsi(closes_f) if len(closes_f) >= 15 else _daily_rsi(closes_f, period=min(14, max(2, len(closes_f) - 1)))
    weekly_rsi = float(rsi_raw) if rsi_raw is not None else 50.0

    if weekly_change_pct > _FLAT_THRESHOLD_PCT:
        weekly_bias = "bullish"
    elif weekly_change_pct < -_FLAT_THRESHOLD_PCT:
        weekly_bias = "bearish"
    else:
        weekly_bias = "neutral"

    note_parts = [f"Weekly change {_fmt_pct(weekly_change_pct)} vs prior 5 sessions."]
    if weekly_rsi >= _RSI_OVERBOUGHT:
        note_parts.append(f"Weekly RSI {weekly_rsi:.0f} — overbought.")
    elif weekly_rsi <= _RSI_OVERSOLD:
        note_parts.append(f"Weekly RSI {weekly_rsi:.0f} — oversold.")
    else:
        note_parts.append(f"Weekly RSI {weekly_rsi:.0f}.")

    return {
        "weekly_bias": weekly_bias,
        "weekly_change_pct": round(weekly_change_pct, 2),
        "weekly_rsi": round(weekly_rsi, 1),
        "weekly_note": " ".join(note_parts),
        "bars_used": len(window),
    }


def _fmt_pct(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.1f}%"


def get_timeframe_alignment(daily_bias: str, weekly_bias: str) -> dict[str, Any]:
    """
    Compare daily (technical) bias vs weekly bias.

    ``composite_score_modifier``: +10 aligned strong, -10 counter-trend, else 0.
    """
    daily = _verdict_to_bias(daily_bias)
    weekly = _verdict_to_bias(weekly_bias)

    if daily == weekly and daily in ("bullish", "bearish"):
        return {
            "aligned": True,
            "strength": "strong",
            "composite_score_modifier": 10,
            "label": f"Daily and weekly both {daily}",
        }

    if (daily == "bullish" and weekly == "bearish") or (daily == "bearish" and weekly == "bullish"):
        return {
            "aligned": False,
            "strength": "counter-trend",
            "composite_score_modifier": -10,
            "label": f"Counter-trend: daily {daily}, weekly {weekly}",
        }

    if daily == weekly:
        return {
            "aligned": True,
            "strength": "moderate",
            "composite_score_modifier": 0,
            "label": "Daily and weekly both neutral",
        }

    return {
        "aligned": False,
        "strength": "moderate",
        "composite_score_modifier": 0,
        "label": f"Mixed timeframe: daily {daily}, weekly {weekly}",
    }


def apply_timeframe_score_modifier(composite_score: float, modifier: int) -> float:
    """Apply modifier on 0–100 scale, return composite score in [-1, 1]."""
    raw_100 = (float(composite_score) + 1.0) * 50.0
    final_100 = max(0.0, min(100.0, raw_100 + float(modifier)))
    return max(-1.0, min(1.0, round(final_100 / 50.0 - 1.0, 4)))

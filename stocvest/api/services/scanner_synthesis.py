"""
Synthesizes scanner evaluation-trace rows into grouped market context for the day desk UI.

Pure functions only — no I/O. Input rows match `build_intraday_evaluation_traces` output
(symbol, desk, gate, detail, margin_pct, score, min_score).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

MARKET_PROXY_SYMBOLS = frozenset({"SPY", "QQQ", "IWM"})

SESSION_VOLUME_GATES = frozenset({"session_rvol", "session_volume"})
LIQUIDITY_GATES = frozenset({"liquidity"})
STRUCTURE_GATES = frozenset(
    {
        "no_triggers",
        "insufficient_bars",
        "invalid_bars",
        "invalid_timeframe",
        "min_price",
        "score_floor",
        "insufficient_history",
    }
)


class RejectionCategory(str, Enum):
    SESSION_VOLUME = "session_volume"
    LIQUIDITY = "liquidity"
    STRUCTURE = "structure"
    OTHER = "other"


@dataclass
class RejectedSymbol:
    symbol: str
    category: RejectionCategory
    reason_label: str
    pct_below_threshold: float | None = None


@dataclass
class NearMissSymbol:
    symbol: str
    pct_of_needed: float
    structure_note: str
    is_market_proxy: bool = False


@dataclass
class VolumeContext:
    avg_pct_below_today: float
    trend: str
    time_of_day: str
    recovery_likely: bool
    market_condition_label: str
    prior_session_avg_pct: float | None = None


@dataclass
class ScannerSynthesis:
    qualified_count: int
    session_volume_rejections: list[RejectedSymbol] = field(default_factory=list)
    liquidity_rejections: list[RejectedSymbol] = field(default_factory=list)
    structure_rejections: list[RejectedSymbol] = field(default_factory=list)
    other_rejections: list[RejectedSymbol] = field(default_factory=list)
    near_misses: list[NearMissSymbol] = field(default_factory=list)
    volume_context: VolumeContext | None = None
    market_summary: str = ""
    what_would_change: str = ""
    session_time_et: str = ""


def _gate_label(gate: str) -> str:
    g = (gate or "").strip().lower()
    if g in SESSION_VOLUME_GATES:
        return "Session volume"
    if g in LIQUIDITY_GATES:
        return "Liquidity"
    if g == "score_floor":
        return "Score floor"
    if g == "no_triggers":
        return "No triggers"
    return g.replace("_", " ").title()


def classify_gate(gate: str) -> RejectionCategory:
    g = (gate or "").strip().lower()
    if g in SESSION_VOLUME_GATES:
        return RejectionCategory.SESSION_VOLUME
    if g in LIQUIDITY_GATES:
        return RejectionCategory.LIQUIDITY
    if g in STRUCTURE_GATES:
        return RejectionCategory.STRUCTURE
    return RejectionCategory.OTHER


def _row_gate(row: dict[str, Any]) -> str:
    gate = str(row.get("gate") or "").strip().lower()
    if gate:
        return gate
    reason_type = str(row.get("reason_type") or "").strip().lower()
    alias = {
        "session_volume": "session_volume",
        "liquidity": "liquidity",
        "pattern": "no_triggers",
        "technical": "no_triggers",
        "structure": "score_floor",
    }
    return alias.get(reason_type, reason_type)


def trace_row_to_rejection(row: dict[str, Any]) -> RejectedSymbol:
    gate = _row_gate(row)
    margin = row.get("margin_pct")
    if margin is None:
        margin = row.get("pct_below_threshold")
    pct: float | None = None
    if isinstance(margin, (int, float)):
        pct = float(margin)
    return RejectedSymbol(
        symbol=str(row.get("symbol") or "").strip().upper(),
        category=classify_gate(gate),
        reason_label=_gate_label(gate),
        pct_below_threshold=pct,
    )


def _parse_time_of_day(session_time_et: str) -> str:
    m = re.search(r"(\d{1,2}):(\d{2})\s*(AM|PM)", session_time_et.strip().upper())
    if not m:
        return "mid"
    hour = int(m.group(1)) % 12
    minute = int(m.group(2))
    if m.group(3) == "PM":
        hour += 12
    total = hour * 60 + minute
    open_min = 9 * 60 + 30
    if total < open_min + 60:
        return "early"
    if total >= 14 * 60:
        return "late"
    return "mid"


def _volume_range_label(pcts: list[float]) -> str:
    if not pcts:
        return ""
    lo = int(min(pcts))
    hi = int(max(pcts))
    if lo == hi:
        return f"{lo}%"
    return f"{lo}–{hi}%"


def _build_market_summary(
    session_vol: list[RejectedSymbol],
    liquidity: list[RejectedSymbol],
    structure: list[RejectedSymbol],
    qualified_count: int,
) -> str:
    if qualified_count > 0 and not session_vol and not liquidity and not structure:
        return (
            f"{qualified_count} setup{'s' if qualified_count != 1 else ''} met all required gates "
            "on this scan. Symbols that did not qualify are listed below for context."
        )
    if session_vol and len(session_vol) >= max(1, len(liquidity) + len(structure)):
        pcts = [r.pct_below_threshold for r in session_vol if r.pct_below_threshold is not None]
        span = _volume_range_label([float(p) for p in pcts if p is not None])
        if span:
            return (
                f"Broad market volume is running {span} below expected intraday pace. "
                "Scanner rejections on this scan reflect market-wide participation, not isolated symbol weakness."
            )
        return (
            "Session volume is below the intraday pace the day desk expects. "
            "Multiple symbols share the same market-wide constraint rather than symbol-specific breakdowns."
        )
    if liquidity and not session_vol:
        return (
            "Symbols in the active universe do not meet the minimum liquidity threshold. "
            "This filter is structural and is not driven by today's session conditions."
        )
    if not session_vol and not liquidity and not structure:
        return "No symbols were evaluated with rejection detail on this scan."
    parts: list[str] = []
    if session_vol:
        parts.append("session volume")
    if liquidity:
        parts.append("liquidity")
    if structure:
        parts.append("structure gates")
    lead = ", ".join(parts[:-1]) + (" and " + parts[-1] if len(parts) > 1 else parts[0])
    return (
        f"Primary scan constraints today are {lead}. "
        "Review grouped details below rather than treating each symbol in isolation."
    )


def _build_what_would_change(time_of_day: str, session_vol: list[RejectedSymbol]) -> str:
    if not session_vol:
        return (
            "Watch for a pickup in broad session volume or for a symbol to clear structure and score gates "
            "on a later refresh."
        )
    if time_of_day == "early":
        return (
            "Volume often develops after the first hour of regular trading. "
            "Re-run the scan after 10:30 AM ET if participation improves."
        )
    if time_of_day == "late":
        return (
            "Afternoon sessions sometimes recover in the final 90 minutes. "
            "If pace improves, SPY and QQQ are the usual leading indicators of broader pickup."
        )
    proxies = [r.symbol for r in session_vol if r.symbol in MARKET_PROXY_SYMBOLS]
    if proxies:
        return (
            f"Watch {', '.join(proxies[:3])} for session pace recovery — when proxies improve, "
            "other names in the universe often follow."
        )
    return (
        "A mid-session volume recovery would be the main change to watch for. "
        "Re-run the scan after participation firms up."
    )


def build_scanner_synthesis(
    rejections: list[dict[str, Any]],
    *,
    qualified_count: int,
    session_time_et: str,
    prior_session_volume_pct: float | None = None,
    desk_filter: str | None = "day",
) -> ScannerSynthesis:
    """
    Build synthesis from evaluation-trace rows or normalized rejection dicts.

    desk_filter: when set, only rows with matching `desk` are included (default day).
    """
    filtered: list[dict[str, Any]] = []
    for row in rejections:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym:
            continue
        if desk_filter:
            desk = str(row.get("desk") or "").strip().lower()
            if desk != desk_filter:
                continue
        filtered.append(row)

    classified = [trace_row_to_rejection(r) for r in filtered]
    session_vol = [r for r in classified if r.category == RejectionCategory.SESSION_VOLUME]
    liquidity = [r for r in classified if r.category == RejectionCategory.LIQUIDITY]
    structure = [r for r in classified if r.category == RejectionCategory.STRUCTURE]
    other = [r for r in classified if r.category == RejectionCategory.OTHER]

    time_of_day = _parse_time_of_day(session_time_et)

    volume_context: VolumeContext | None = None
    if session_vol:
        pcts = [r.pct_below_threshold for r in session_vol if r.pct_below_threshold is not None]
        avg_deficit = sum(float(p) for p in pcts) / len(pcts) if pcts else 0.0
        if prior_session_volume_pct is not None:
            if avg_deficit < prior_session_volume_pct - 5:
                trend = "improving"
            elif avg_deficit > prior_session_volume_pct + 5:
                trend = "worsening"
            else:
                trend = "stable"
        else:
            trend = "stable"
        if avg_deficit > 60:
            condition = "Low participation"
        elif avg_deficit > 30:
            condition = "Below average"
        else:
            condition = "Normal"
        volume_context = VolumeContext(
            avg_pct_below_today=round(avg_deficit, 1),
            trend=trend,
            prior_session_avg_pct=prior_session_volume_pct,
            time_of_day=time_of_day,
            recovery_likely=time_of_day == "late",
            market_condition_label=condition,
        )

    near_misses: list[NearMissSymbol] = []
    vol_candidates = [
        r
        for r in session_vol
        if r.pct_below_threshold is not None and r.pct_below_threshold < 95
    ]
    vol_candidates.sort(key=lambda r: 100.0 - float(r.pct_below_threshold or 0), reverse=True)
    for r in vol_candidates[:3]:
        pct_below = float(r.pct_below_threshold or 0)
        pct_of_needed = max(0.0, min(100.0, 100.0 - pct_below))
        near_misses.append(
            NearMissSymbol(
                symbol=r.symbol,
                pct_of_needed=round(pct_of_needed, 1),
                structure_note="Session pace lagging; price structure not the primary block",
                is_market_proxy=r.symbol in MARKET_PROXY_SYMBOLS,
            )
        )

    market_summary = _build_market_summary(session_vol, liquidity, structure, qualified_count)
    what_would_change = _build_what_would_change(time_of_day, session_vol)

    return ScannerSynthesis(
        qualified_count=qualified_count,
        session_volume_rejections=session_vol,
        liquidity_rejections=liquidity,
        structure_rejections=structure,
        other_rejections=other,
        near_misses=near_misses,
        volume_context=volume_context,
        market_summary=market_summary,
        what_would_change=what_would_change,
        session_time_et=session_time_et,
    )


def synthesis_to_api_dict(synthesis: ScannerSynthesis) -> dict[str, Any]:
    """Serialize for JSON API responses."""
    session_sorted = sorted(
        synthesis.session_volume_rejections,
        key=lambda r: (r.pct_below_threshold if r.pct_below_threshold is not None else 999.0),
    )
    return {
        "qualified_count": synthesis.qualified_count,
        "market_summary": synthesis.market_summary,
        "what_would_change": synthesis.what_would_change,
        "session_time_et": synthesis.session_time_et,
        "volume_context": (
            {
                "avg_pct_below": synthesis.volume_context.avg_pct_below_today,
                "trend": synthesis.volume_context.trend,
                "time_of_day": synthesis.volume_context.time_of_day,
                "recovery_likely": synthesis.volume_context.recovery_likely,
                "market_condition": synthesis.volume_context.market_condition_label,
            }
            if synthesis.volume_context
            else None
        ),
        "near_misses": [
            {
                "symbol": nm.symbol,
                "pct_of_needed": nm.pct_of_needed,
                "structure_note": nm.structure_note,
                "is_market_proxy": nm.is_market_proxy,
            }
            for nm in synthesis.near_misses
        ],
        "rejection_groups": {
            "session_volume": [
                {"symbol": r.symbol, "pct_below": r.pct_below_threshold}
                for r in session_sorted
                if r.pct_below_threshold is not None
            ],
            "liquidity": [{"symbol": r.symbol} for r in synthesis.liquidity_rejections],
            "structure": [
                {"symbol": r.symbol, "reason": r.reason_label}
                for r in synthesis.structure_rejections
            ],
            "other": [
                {"symbol": r.symbol, "reason": r.reason_label} for r in synthesis.other_rejections
            ],
        },
    }

"""
Laggard narrative builder — deterministic copy (Chunk 5). No I/O.

Display context only: no trade advice, no predictive language.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from stocvest.signals.laggard_detector import (
    LaggardContext,
    LaggardResult,
    LaggardType,
)

_FORBIDDEN = frozenset(
    {
        "will",
        "should",
        "going to",
        "buy",
        "sell",
        "trade",
        "invest",
        "profit",
        "win",
        "lose",
        "likely",
    }
)

_GENERIC_WATCH_PHRASES = frozenset(
    {
        "watch the stock",
        "watch this stock",
        "monitor the stock",
        "keep an eye on the stock",
    }
)


@dataclass(frozen=True)
class LaggardNarrative:
    summary_line: str
    explanation: str
    what_to_watch: str
    driver_label: str


def _pct(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.1f}%"


def _cluster_leader(group_name: str) -> str:
    match = re.match(r"Dynamic cluster:\s*(\S+)", group_name or "", re.IGNORECASE)
    return match.group(1).upper() if match else "leader"


def _peer_mover_names(result: LaggardResult, limit: int = 3) -> str:
    names = [p.symbol for p in result.peers_moving[:limit]]
    if not names:
        return "peers"
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{names[0]}, {names[1]}, and {names[2]}"


def _driver_label(ctx: LaggardContext, result: LaggardResult) -> str:
    driver = result.driver_type
    if driver == "pre_ipo_proxy" and ctx.trigger_entity:
        return f"{ctx.trigger_entity} ecosystem"
    if driver == "dynamic_cluster":
        leader = _cluster_leader(result.group_name)
        return f"Dynamic cluster: {leader}"
    if driver == "macro":
        return ctx.sector_name or "Rate-sensitive growth"
    if driver == "index":
        return ctx.sector_name or "Index heavyweights"
    if driver == "theme":
        return ctx.sector_name or "Theme peers"
    return ctx.sector_name or result.group_name


def _moving_framing(driver: str, label: str) -> str:
    if driver == "macro":
        return f"{label} names are moving"
    if driver == "index":
        return "Index-weighted large caps are advancing"
    if driver == "theme":
        return f"{label} stocks are moving"
    if driver == "pre_ipo_proxy":
        return f"{label}-adjacent stocks are moving"
    if driver == "dynamic_cluster":
        leader = _cluster_leader(label) if label.startswith("Dynamic") else _cluster_leader(label)
        return f"An emerging cluster around {leader} is moving"
    return f"{label} sector is moving"


def _build_catch_up(ctx: LaggardContext, result: LaggardResult, label: str) -> LaggardNarrative:
    sym = ctx.symbol.upper()
    driver = result.driver_type
    move_frame = _moving_framing(driver, label)
    explanation = (
        f"{move_frame} ({_pct(result.avg_peer_move_1d)} avg 1d) while {sym} "
        f"is up only {_pct(ctx.symbol_move_1d)} today, lagging peers by "
        f"{_pct(result.lag_vs_peers_1d)} on the session. "
        f"5d peer drift is {_pct(result.avg_peer_move_5d)} vs {_pct(ctx.symbol_move_5d)} "
        f"for {sym}, with {result.volume_pattern} volume."
    )
    watch = (
        f"Whether {_peer_mover_names(result)} stay elevated and {sym} closes nearer "
        f"the peer average without heavy distribution volume."
    )
    summary = (
        f"{sym} lags {label[:28]} peers {_pct(result.lag_vs_peers_1d)}"
        if len(label) <= 28
        else f"{sym} lags peers {_pct(result.lag_vs_peers_1d)} today"
    )
    return LaggardNarrative(
        summary_line=summary[:60],
        explanation=explanation,
        what_to_watch=watch,
        driver_label=label,
    )


def _build_pre_breakout(ctx: LaggardContext, result: LaggardResult, label: str) -> LaggardNarrative:
    sym = ctx.symbol.upper()
    driver = result.driver_type
    move_frame = _moving_framing(driver, label)
    explanation = (
        f"{move_frame} on a {_pct(result.avg_peer_move_5d)} 5d basis while {sym} "
        f"has coiled near {_pct(ctx.symbol_move_1d)} today with contracting volume "
        f"({ctx.symbol_vol_ratio:.1f}x vs average). "
        f"Session lag vs peers is {_pct(result.lag_vs_peers_1d)} with structure "
        f"{ctx.technical_structure}."
    )
    watch = (
        f"Volume expansion above 0.8x average if {sym} begins tracking "
        f"{_peer_mover_names(result)} while the group keeps advancing."
    )
    summary = f"{sym} coiled vs {label[:22]} group rally"[:60]
    return LaggardNarrative(
        summary_line=summary[:60],
        explanation=explanation,
        what_to_watch=watch,
        driver_label=label,
    )


def _build_distribution(ctx: LaggardContext, result: LaggardResult, label: str) -> LaggardNarrative:
    sym = ctx.symbol.upper()
    driver = result.driver_type
    if driver == "macro":
        opener = f"{label} names are advancing"
    elif driver == "dynamic_cluster":
        leader = _cluster_leader(result.group_name)
        opener = f"An emerging cluster around {leader} is advancing"
    elif driver == "pre_ipo_proxy" and ctx.trigger_entity:
        opener = f"{ctx.trigger_entity}-adjacent stocks are advancing"
    else:
        opener = f"{label} is advancing"
    explanation = (
        f"{opener} ({_pct(result.avg_peer_move_1d)} peer avg 1d) while {sym} "
        f"shows weakness at {_pct(ctx.symbol_move_1d)} with {result.volume_pattern} "
        f"volume ({ctx.symbol_vol_ratio:.1f}x). "
        f"This is relative weakness, not a catch-up setup."
    )
    watch = (
        f"Down-volume persistence if peers hold gains — especially "
        f"while {_peer_mover_names(result)} remain positive on the day."
    )
    summary = f"{sym} weak vs rising {label[:20]} peers"[:60]
    return LaggardNarrative(
        summary_line=summary[:60],
        explanation=explanation,
        what_to_watch=watch,
        driver_label=label,
    )


def build_narrative(ctx: LaggardContext, result: LaggardResult) -> LaggardNarrative:
    """Build validated narrative for a detected laggard."""
    label = _driver_label(ctx, result)
    if result.laggard_type == LaggardType.PRE_BREAKOUT:
        narrative = _build_pre_breakout(ctx, result, label)
    elif result.laggard_type == LaggardType.DISTRIBUTION:
        narrative = _build_distribution(ctx, result, label)
    else:
        narrative = _build_catch_up(ctx, result, label)
    _validate_narrative(narrative)
    return narrative


def _validate_narrative(n: LaggardNarrative) -> None:
    assert len(n.summary_line) <= 60, f"summary_line too long ({len(n.summary_line)})"
    full = f" {n.explanation} {n.what_to_watch} {n.summary_line} ".lower()
    for word in _FORBIDDEN:
        needle = f" {word} "
        assert needle not in full, f"Forbidden word '{word}' in narrative"
    watch_lower = n.what_to_watch.strip().lower()
    assert watch_lower not in _GENERIC_WATCH_PHRASES, "what_to_watch is too generic"
    assert "%" in n.explanation or any(c.isdigit() for c in n.explanation), (
        "explanation must include numeric context"
    )
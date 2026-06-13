"""
Setup judgment — quality vs tradeability split (engine-facing + API).

Quality reflects multi-layer agreement (not a reweighted technical score).
Tradeability reflects entry geometry (extension, phase) — not R/R gates or clock time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from stocvest.analytics.unlock_forecast import (
    _layer_aligned,
    composite_bias_from_summary,
    derive_missing_layers,
)
from stocvest.models.watchlist import MATURATION_LAYER_KEYS

SetupPhase = Literal["early", "expansion", "extended", "exhaustion"]
ProcessTier = Literal["not_aligned", "developing", "near_ready", "actionable"]
TradeabilityBand = Literal["strong", "moderate", "weak"]
FlagSeverity = Literal["warn", "block"]

_LAYER_LABEL: dict[str, str] = {
    "technical": "Technical",
    "news": "News",
    "macro": "Macro",
    "sector": "Sector",
    "geopolitical": "Geopolitical",
    "internals": "Market Internals",
}

_PROCESS_LABEL: dict[ProcessTier, str] = {
    "not_aligned": "Not aligned",
    "developing": "Developing",
    "near_ready": "Near ready",
    "actionable": "Strong",
}

_PHASE_LABEL: dict[SetupPhase, str] = {
    "early": "Early",
    "expansion": "Expansion",
    "extended": "Extended",
    "exhaustion": "Exhaustion",
}

_TRADEABILITY_LABEL: dict[TradeabilityBand, str] = {
    "strong": "Strong entry timing",
    "moderate": "Moderate entry timing",
    "weak": "Weak entry timing",
}


@dataclass(frozen=True)
class TradeabilityFlag:
    id: str
    label: str
    severity: FlagSeverity

    def to_dict(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "severity": self.severity}


def _count_aligned(layers: list[dict[str, Any]], *, composite_bias: str) -> int:
    bias = composite_bias_from_summary(composite_bias)
    n = 0
    for lid in MATURATION_LAYER_KEYS:
        row = next((r for r in layers if str(r.get("layer") or "").lower() == lid), None)
        if row and _layer_aligned(row, composite_bias=bias):
            n += 1
    return n


def _process_tier(aligned: int, total: int = 6) -> ProcessTier:
    if aligned >= 5:
        return "actionable"
    if aligned == 4:
        return "near_ready"
    if aligned >= 2:
        return "developing"
    return "not_aligned"


def _quality_score(aligned: int, alignment_ratio: float | None, total: int = 6) -> int:
    base = int(round(100.0 * float(aligned) / float(total)))
    if alignment_ratio is not None:
        ar = max(0.0, min(1.0, float(alignment_ratio)))
        base = int(round(0.72 * base + 0.28 * (ar * 100.0)))
    return max(0, min(100, base))


def _resolve_phase_swing(daily_rsi: float | None) -> SetupPhase | None:
    if daily_rsi is None:
        return None
    if daily_rsi >= 80:
        return "exhaustion"
    if daily_rsi >= 70:
        return "extended"
    if daily_rsi >= 60:
        return "expansion"
    return "early"


def _resolve_phase_day(rsi: float | None) -> SetupPhase | None:
    if rsi is None:
        return None
    if rsi >= 75:
        return "exhaustion"
    if rsi >= 65:
        return "extended"
    if rsi >= 55:
        return "expansion"
    return "early"


def _extension_flags_swing(
    *,
    last: float | None,
    sma50: float | None,
    daily_rsi: float | None,
    params_extension_pct: float = 15.0,
    params_rsi_overbought: float = 70.0,
) -> list[TradeabilityFlag]:
    flags: list[TradeabilityFlag] = []
    if daily_rsi is not None:
        if daily_rsi >= 80:
            flags.append(
                TradeabilityFlag("rsi_exhaustion", f"RSI {daily_rsi:.0f} — exhaustion zone", "block")
            )
        elif daily_rsi >= 76:
            flags.append(
                TradeabilityFlag("rsi_extended", f"RSI {daily_rsi:.0f} — extended momentum", "block")
            )
        elif daily_rsi >= params_rsi_overbought:
            flags.append(
                TradeabilityFlag("rsi_extended", f"RSI {daily_rsi:.0f} — extended momentum", "warn")
            )
    if last is not None and sma50 is not None and sma50 > 0:
        ext = (last - sma50) / sma50 * 100.0
        if ext >= params_extension_pct:
            flags.append(
                TradeabilityFlag(
                    "above_sma50",
                    f"Price {ext:.0f}% above SMA50 — stretched vs mean",
                    "block" if ext >= params_extension_pct * 1.25 else "warn",
                )
            )
    return flags


def _extension_flags_day(
    *,
    rsi: float | None,
    last: float | None,
    session_open: float | None,
    atr: float | None,
    params_rsi_overbought: float = 70.0,
) -> list[TradeabilityFlag]:
    flags: list[TradeabilityFlag] = []
    if rsi is not None:
        if rsi >= 75:
            flags.append(
                TradeabilityFlag("rsi_exhaustion", f"Session RSI {rsi:.0f} — exhaustion zone", "block")
            )
        elif rsi >= params_rsi_overbought:
            flags.append(
                TradeabilityFlag("rsi_extended", f"Session RSI {rsi:.0f} — extended", "warn")
            )
    if last is not None and session_open is not None and atr is not None and atr > 0:
        move = abs(last - session_open)
        ratio = move / atr
        if ratio >= 2.0:
            flags.append(
                TradeabilityFlag(
                    "session_move_2x_atr",
                    f"Session move ~{ratio:.1f}× ATR — late for fresh entry",
                    "block",
                )
            )
        elif ratio >= 1.5:
            flags.append(
                TradeabilityFlag(
                    "session_move_1_5x_atr",
                    f"Session move ~{ratio:.1f}× ATR — pace already extended",
                    "warn",
                )
            )
    return flags


def _tradeability_score(flags: list[TradeabilityFlag], phase: SetupPhase | None) -> int:
    score = 100
    for f in flags:
        score -= 25 if f.severity == "block" else 12
    if phase == "extended":
        score -= 10
    elif phase == "exhaustion":
        score -= 20
    elif phase == "early":
        score += 5
    return max(0, min(100, score))


def _tradeability_band(score: int, flags: list[TradeabilityFlag]) -> TradeabilityBand:
    if any(f.severity == "block" for f in flags) or score < 40:
        return "weak"
    if score >= 70:
        return "strong"
    return "moderate"


def _primary_blocker(
    missing_layers: list[str],
    flags: list[TradeabilityFlag],
) -> str | None:
    blocks = [f for f in flags if f.severity == "block"]
    if blocks:
        return blocks[0].label
    if missing_layers:
        labels = [_LAYER_LABEL.get(l, l.title()) for l in missing_layers[:3]]
        return f"Missing alignment: {', '.join(labels)}"
    warns = [f for f in flags if f.severity == "warn"]
    if warns:
        return warns[0].label
    return None


def _watch_for(
    unlock_forecast: list[dict[str, Any]] | None,
    missing_layers: list[str],
    flags: list[TradeabilityFlag],
) -> str | None:
    if unlock_forecast:
        primary = next((h for h in unlock_forecast if h.get("is_primary_blocker")), None)
        if primary is None and unlock_forecast:
            primary = unlock_forecast[0]
        if primary:
            trigger = str(primary.get("trigger_condition") or "").strip()
            if trigger:
                return trigger
            dist = str(primary.get("distance_description") or "").strip()
            if dist:
                return dist
    if flags:
        block = next((f for f in flags if f.severity == "block"), None)
        if block:
            return f"Watch for pullback or structure reset — {block.label.lower()}"
    if missing_layers:
        lid = missing_layers[0]
        return f"Watch {_LAYER_LABEL.get(lid, lid)} for alignment with setup bias"
    return None


def build_setup_judgment(
    *,
    mode: Literal["day", "swing"],
    layers: list[dict[str, Any]],
    signal_summary: str,
    alignment_ratio: float | None = None,
    unlock_forecast: list[dict[str, Any]] | None = None,
    tech_result: Any | None = None,
    bars: list[Any] | None = None,
) -> dict[str, Any]:
    """Build API ``setup_judgment`` object for composite responses."""
    total = len(MATURATION_LAYER_KEYS)
    summary = (signal_summary or "neutral").strip().lower()
    binary_aligned = _count_aligned(layers, composite_bias=summary)
    # Setup progress uses directional agreement (verdict matches bias), not weighted ratio.
    aligned = binary_aligned
    tier = _process_tier(aligned, total)
    missing = derive_missing_layers(layers, composite_bias=composite_bias_from_summary(summary))

    phase: SetupPhase | None = None
    flags: list[TradeabilityFlag] = []

    if mode == "swing" and tech_result is not None:
        rsi = getattr(tech_result, "daily_rsi", None)
        sma50 = getattr(tech_result, "sma50", None)
        last = None
        if bars:
            try:
                closes = [float(b.close) for b in bars if getattr(b, "close", None)]
                last = closes[-1] if closes else None
            except (TypeError, ValueError):
                last = None
        phase = _resolve_phase_swing(float(rsi) if rsi is not None else None)
        flags = _extension_flags_swing(
            last=last,
            sma50=float(sma50) if sma50 is not None else None,
            daily_rsi=float(rsi) if rsi is not None else None,
        )
    elif mode == "day" and tech_result is not None:
        rsi = getattr(tech_result, "rsi", None)
        atr = getattr(tech_result, "atr", None)
        last = None
        session_open = None
        if bars:
            try:
                closes = [float(b.close) for b in bars if getattr(b, "close", None)]
                if closes:
                    last = closes[-1]
                    session_open = closes[0]
            except (TypeError, ValueError):
                pass
        phase = _resolve_phase_day(float(rsi) if rsi is not None else None)
        flags = _extension_flags_day(
            rsi=float(rsi) if rsi is not None else None,
            last=last,
            session_open=session_open,
            atr=float(atr) if atr is not None else None,
        )

    q_score = _quality_score(binary_aligned, alignment_ratio, total)
    t_score = _tradeability_score(flags, phase)
    t_band = _tradeability_band(t_score, flags)
    blocker = _primary_blocker(missing, flags)
    watch = _watch_for(unlock_forecast, missing, flags)

    return {
        "process": {
            "tier": tier,
            "label": _PROCESS_LABEL[tier],
            "layers_aligned": aligned,
            "layers_total": total,
        },
        "setup_phase": (
            {"id": phase, "label": _PHASE_LABEL[phase]} if phase is not None else None
        ),
        "tradeability": {
            "band": t_band,
            "label": _TRADEABILITY_LABEL[t_band],
            "flags": [f.to_dict() for f in flags],
        },
        "primary_blocker": blocker,
        "watch_for": watch,
        "engine_scores": {
            "quality": q_score,
            "tradeability": t_score,
        },
    }

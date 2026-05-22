"""Soft execution-quality metrics for composite responses (Phase 2 — not ledger gates)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from stocvest.api.services.validation_timing import (
    is_day_ledger_entry_session_et,
    is_swing_ledger_entry_window_et,
)

ExecutionQualityBand = Literal["strong", "moderate", "weak", "unavailable"]

# Soft bands — informational only; do not use as hard gates until Phase 3 review.
_STOP_ATR_STRONG_MAX = 1.25
_STOP_ATR_MODERATE_MAX = 2.0
_VOLUME_STRONG_MIN = 0.8
_VOLUME_MODERATE_MIN = 0.35


def build_execution_quality_payload(
    *,
    mode: Literal["day", "swing"],
    price_at_signal: float | None,
    reference_stop_level: float | None,
    reference_target_1: float | None,
    risk_reward: float | None,
    atr: float | None,
    volume_ratio: float | None,
    orb_signal: str | None = None,
    vwap_state: str | None = None,
    ref_utc: datetime | None = None,
) -> dict[str, Any]:
    """Return a JSON-serializable soft execution-quality block for composite APIs."""
    now = ref_utc or datetime.now(timezone.utc)
    stop_atr_ratio = _stop_atr_ratio(
        price=price_at_signal,
        stop=reference_stop_level,
        atr=atr,
    )
    level_path = _level_path_quality(
        stop=reference_stop_level,
        target=reference_target_1,
        risk_reward=risk_reward,
    )
    volume_band = _volume_band(volume_ratio)
    session = _session_window_flags(mode=mode, ref_utc=now)
    band = _overall_band(
        stop_atr_ratio=stop_atr_ratio,
        level_path=level_path,
        volume_band=volume_band,
        risk_reward=risk_reward,
        mode=mode,
    )
    return {
        "band": band,
        "stop_atr_ratio": stop_atr_ratio,
        "level_path": level_path,
        "volume_ratio": round(volume_ratio, 3) if volume_ratio is not None else None,
        "volume_band": volume_band,
        "risk_reward": round(risk_reward, 2) if risk_reward is not None else None,
        "session_window": session,
        "setup_tags": _setup_tags(orb_signal=orb_signal, vwap_state=vwap_state),
        "disclaimer": (
            "Execution quality is informational only — it does not change actionable verdicts "
            "or validation ledger gates."
        ),
    }


def _stop_atr_ratio(
    *,
    price: float | None,
    stop: float | None,
    atr: float | None,
) -> float | None:
    if price is None or stop is None or atr is None:
        return None
    try:
        p = float(price)
        s = float(stop)
        a = float(atr)
    except (TypeError, ValueError):
        return None
    if p <= 0 or a <= 0:
        return None
    risk_dist = abs(p - s)
    if risk_dist <= 0:
        return None
    return round(risk_dist / a, 2)


def _level_path_quality(
    *,
    stop: float | None,
    target: float | None,
    risk_reward: float | None,
) -> dict[str, Any]:
    has_stop = stop is not None
    has_target = target is not None
    rr_ok = risk_reward is not None and float(risk_reward) > 0
    complete = has_stop and has_target and rr_ok
    return {
        "has_reference_stop": has_stop,
        "has_reference_target": has_target,
        "structure_complete": complete,
    }


def _volume_band(volume_ratio: float | None) -> str | None:
    if volume_ratio is None:
        return None
    try:
        v = float(volume_ratio)
    except (TypeError, ValueError):
        return None
    if v >= _VOLUME_STRONG_MIN:
        return "strong"
    if v >= _VOLUME_MODERATE_MIN:
        return "moderate"
    return "weak"


def _session_window_flags(*, mode: str, ref_utc: datetime) -> dict[str, bool]:
    if mode == "swing":
        return {
            "in_swing_ledger_window": is_swing_ledger_entry_window_et(ref_utc),
            "in_day_ledger_window": False,
        }
    return {
        "in_swing_ledger_window": False,
        "in_day_ledger_window": is_day_ledger_entry_session_et(ref_utc),
    }


def _setup_tags(*, orb_signal: str | None, vwap_state: str | None) -> list[str]:
    tags: list[str] = []
    orb = (orb_signal or "").strip().lower()
    if orb and orb not in ("unavailable", "none"):
        tags.append(f"orb:{orb}")
    vwap = (vwap_state or "").strip().lower()
    if vwap and vwap not in ("unavailable", "none"):
        tags.append(f"vwap:{vwap}")
    return tags


def _overall_band(
    *,
    stop_atr_ratio: float | None,
    level_path: dict[str, Any],
    volume_band: str | None,
    risk_reward: float | None,
    mode: str,
) -> ExecutionQualityBand:
    if not level_path.get("structure_complete"):
        return "unavailable"
    score = 0
    if stop_atr_ratio is not None:
        if stop_atr_ratio <= _STOP_ATR_STRONG_MAX:
            score += 2
        elif stop_atr_ratio <= _STOP_ATR_MODERATE_MAX:
            score += 1
    if volume_band == "strong":
        score += 2
    elif volume_band == "moderate":
        score += 1
    min_rr = 1.3 if mode == "day" else 2.0
    if risk_reward is not None and float(risk_reward) >= min_rr:
        score += 1
    if score >= 4:
        return "strong"
    if score >= 2:
        return "moderate"
    return "weak"

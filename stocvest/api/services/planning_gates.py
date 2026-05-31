"""Soft planning context checklist for composite APIs (informational — not ledger gates)."""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Any, Literal

from stocvest.api.services.market_environment import (
    environment_for_ledger_gate,
    min_risk_reward_from_environment,
)
from stocvest.api.services.reference_stop_policy import ATR_K_BY_PRESET
from stocvest.api.services.validation_timing import now_et

Mode = Literal["day", "swing"]
PresetId = Literal["continuation", "dip", "breakout"]

DISCLAIMER = (
    "Planning context summarizes desk readiness. Market environment tier affects validation "
    "ledger gates; it does not change actionable verdicts or layer scores."
)

RISK_CAP_PCT: dict[str, float] = {
    "dip": 1.5,
    "continuation": 3.0,
    "breakout": 4.0,
}

# Preferred day-trade dip window (ET) — soft guidance, not a hard gate.
DAY_DIP_WINDOW_START_ET = time(14, 0)
DAY_DIP_WINDOW_END_ET = time(15, 30)

_VOLUME_AT_LEVEL_MIN = 1.5


def _regime_tag(market_regime: str) -> str:
    reg = str(market_regime or "").strip().lower()
    if reg in ("bullish", "bearish", "risk_on", "risk_off"):
        return "trending"
    if reg in ("neutral", "sideways"):
        return "ranging"
    return "mixed"


def _preset_fit_notes(regime_tag: str) -> dict[str, str]:
    if regime_tag == "ranging":
        return {
            "dip": "Favorable in range — support-edge entries align with chop.",
            "continuation": "Neutral — mid-range needs clear level respect.",
            "breakout": "Caution — breakouts often fail without trend follow-through.",
        }
    if regime_tag == "trending":
        return {
            "dip": "Caution — pullbacks can extend in strong trends.",
            "continuation": "Favorable — trend continuation on retests.",
            "breakout": "Favorable when volume confirms through resistance.",
        }
    return {
        "dip": "Mixed regime — size conservatively at support.",
        "continuation": "Mixed regime — confirm level before sizing.",
        "breakout": "Mixed regime — require volume confirmation.",
    }


def _in_day_dip_window(ref_utc: datetime) -> bool:
    et = now_et(ref_utc)
    if et.weekday() >= 5:
        return False
    t = et.time()
    return DAY_DIP_WINDOW_START_ET <= t <= DAY_DIP_WINDOW_END_ET


def build_planning_gates_payload(
    *,
    mode: Mode,
    market_regime: str,
    risk_reward: float | None,
    execution_quality: dict[str, Any] | None,
    reference_stop_provenance: str | None,
    atr: float | None,
    setup_judgment: dict[str, Any] | None,
    ref_utc: datetime | None = None,
    market_environment: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Informational checklist for Evidence / Scenario (Stage B only)."""
    now = ref_utc or datetime.now(timezone.utc)
    eq = execution_quality if isinstance(execution_quality, dict) else {}
    min_rr = min_risk_reward_from_environment(market_environment, mode=mode)
    regime_tag = _regime_tag(market_regime)
    macro_ok = str(market_regime or "").strip().lower() not in ("avoid",)

    vol_ratio = eq.get("volume_ratio")
    vol_band = str(eq.get("volume_band") or "").strip().lower()
    try:
        vr = float(vol_ratio) if vol_ratio is not None else None
    except (TypeError, ValueError):
        vr = None
    volume_pass = (vr is not None and vr >= _VOLUME_AT_LEVEL_MIN) or vol_band == "strong"

    if mode == "day":
        in_dip_window = _in_day_dip_window(now)
        time_pass = in_dip_window
        time_detail = (
            "Inside 2:00–3:30 PM ET dip window"
            if in_dip_window
            else "Outside preferred dip window — RTH still open for planning"
        )
    else:
        time_pass = True
        time_detail = "Swing horizon — no intraday dip clock window"

    prov = str(reference_stop_provenance or "").lower()
    stop_atr = eq.get("stop_atr_ratio")
    try:
        sar = float(stop_atr) if stop_atr is not None else None
    except (TypeError, ValueError):
        sar = None
    atr_floor_pass = atr is not None and atr > 0 and (
        "atr" in prov or (sar is not None and 0.5 <= sar <= 2.5)
    )
    atr_detail = (
        "ATR floor available on reference stop"
        if atr_floor_pass
        else "ATR missing or stop not merged with ATR policy yet"
    )

    try:
        rr = float(risk_reward) if risk_reward is not None else None
    except (TypeError, ValueError):
        rr = None
    rr_pass = rr is not None and rr >= min_rr
    rr_detail = (
        f"R/R {rr:.1f} : 1 at reference levels (desk min {min_rr:.1f} : 1)"
        if rr_pass and rr is not None
        else f"R/R below desk minimum {min_rr:.1f} : 1 at reference levels"
        if rr is not None
        else "R/R unavailable at reference levels"
    )

    regime_detail = (
        f"Macro regime: {market_regime} — read as {regime_tag}"
        if macro_ok
        else f"Macro regime: {market_regime} — elevated caution"
    )

    tradeability = ""
    if isinstance(setup_judgment, dict):
        tb = setup_judgment.get("tradeability")
        if isinstance(tb, dict):
            tradeability = str(tb.get("band") or "").strip().lower()
    timing_note = ""
    if tradeability == "weak":
        timing_note = " Entry timing band is weak — see setup judgment."

    env_pass = True
    env_detail = "Market environment policy not attached — using default desk R/R floors."
    if isinstance(market_environment, dict):
        env_ok, _ = environment_for_ledger_gate(market_environment, mode=mode)
        env_pass = env_ok
        tier = str(market_environment.get("environment_tier") or "normal")
        headline = str(market_environment.get("headline") or "").strip()
        env_detail = headline or f"Environment tier {tier}."
        if not env_ok:
            env_detail = f"{env_detail} New {mode} validation entries paused."

    checks: list[dict[str, Any]] = [
        {
            "id": "market_environment",
            "label": "Market environment (VIX tier)",
            "pass": env_pass,
            "detail": env_detail,
        },
        {
            "id": "regime",
            "label": "Regime context",
            "pass": macro_ok,
            "detail": regime_detail + timing_note,
        },
        {
            "id": "volume",
            "label": "Volume at level (≥1.5× avg proxy)",
            "pass": volume_pass,
            "detail": (
                f"Volume ratio {vr:.2f}×" if vr is not None else f"Volume band: {vol_band or 'unknown'}"
            ),
        },
        {
            "id": "time_window",
            "label": "Time-of-day window",
            "pass": time_pass,
            "detail": time_detail,
        },
        {
            "id": "atr_floor",
            "label": "ATR floor on reference stop",
            "pass": atr_floor_pass,
            "detail": atr_detail,
        },
        {
            "id": "risk_reward",
            "label": f"R/R ≥ {min_rr:.1f} : 1 (reference geometry)",
            "pass": rr_pass,
            "detail": rr_detail,
        },
    ]

    favorable = all(bool(c.get("pass")) for c in checks)

    return {
        "disclaimer": DISCLAIMER,
        "regime_tag": regime_tag,
        "preset_fit": _preset_fit_notes(regime_tag),
        "risk_cap_pct": dict(RISK_CAP_PCT),
        "atr_k_by_preset": dict(ATR_K_BY_PRESET),
        "min_rr_desk": min_rr,
        "environment_tier": (
            str(market_environment.get("environment_tier"))
            if isinstance(market_environment, dict)
            else None
        ),
        "checks": checks,
        "all_favorable": favorable,
        "summary": (
            "All planning checks favorable at reference levels — still not a trade signal."
            if favorable
            else "Some planning checks are soft warnings — review before sizing."
        ),
    }

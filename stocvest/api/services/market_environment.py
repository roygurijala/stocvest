"""Market environment policy (Layer 0) — VIX tiers before stops, targets, and ledger gates.

Stops use per-symbol ATR + structure only (no VIX multiplier). VIX drives:
- whether new swing/day risk is appropriate
- minimum R/R tier for ledger qualification
- T2 target suppression in stressed/crisis environments
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

ENVIRONMENT_POLICY_VERSION = "env_policy_v2"

EnvironmentTier = Literal["normal", "elevated", "stressed", "crisis"]
TargetPolicy = Literal["t1_and_t2", "t1_preferred", "t1_only"]
Mode = Literal["day", "swing"]
SizeGuidance = Literal["full", "reduced", "minimal"]

# Enter thresholds
TIER_NORMAL_ENTER = 20.0
TIER_ELEVATED_ENTER = 28.0
TIER_CRISIS_ENTER = 32.0

# Exit thresholds (hysteresis — relax one tier at a time)
TIER_NORMAL_EXIT = 19.0
TIER_ELEVATED_EXIT = 27.0
TIER_CRISIS_EXIT = 30.0

# Session spike overlay
SPIKE_MIN_VIX = 22.0
SPIKE_CHANGE_PCT = 10.0

# 5-session VIX rise (FRED daily closes)
SPIKE_5D_MIN_VIX = 20.0
SPIKE_5D_CHANGE_PCT = 12.0

_TIER_ORDER: list[EnvironmentTier] = ["normal", "elevated", "stressed", "crisis"]


def _vix_direction_from_change(change_pct: float | None) -> str:
    if change_pct is None:
        return "flat"
    if change_pct > 0.05:
        return "rising"
    if change_pct < -0.05:
        return "falling"
    return "flat"


def _float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _tier_rank(tier: EnvironmentTier) -> int:
    return _TIER_ORDER.index(tier)


def vix_change_5d_pct_from_observations(
    observations: list[tuple[Any, float]],
    *,
    current_level: float | None = None,
) -> float | None:
    """Percent change from oldest to newest observation in the series (5+ trading days)."""
    valid: list[tuple[Any, float]] = []
    for d, v in observations:
        fv = _float_or_none(v)
        if fv is not None and fv > 0:
            valid.append((d, fv))
    if len(valid) < 2:
        return None
    valid.sort(key=lambda x: x[0])
    oldest = valid[0][1]
    latest = _float_or_none(current_level) if current_level is not None else valid[-1][1]
    if latest is None or oldest <= 0:
        return None
    return round(((latest - oldest) / oldest) * 100.0, 2)


def resolve_environment_tier_raw(
    *,
    vix_level: float | None,
    vix_change_pct: float | None = None,
    vix_change_5d_pct: float | None = None,
) -> EnvironmentTier:
    """Instantaneous tier from VIX enter bands + session / 5d spike overlays."""
    v = _float_or_none(vix_level)
    if v is None:
        return "normal"
    chg = _float_or_none(vix_change_pct)
    chg5 = _float_or_none(vix_change_5d_pct)
    spike_session = chg is not None and chg >= SPIKE_CHANGE_PCT and v >= SPIKE_MIN_VIX
    spike_5d = chg5 is not None and chg5 >= SPIKE_5D_CHANGE_PCT and v >= SPIKE_5D_MIN_VIX
    spike = spike_session or spike_5d
    if v >= TIER_CRISIS_ENTER:
        return "crisis"
    if v >= TIER_ELEVATED_ENTER or spike:
        return "stressed"
    if v >= TIER_NORMAL_ENTER:
        return "elevated"
    return "normal"


def apply_tier_hysteresis(
    previous_tier: EnvironmentTier | None,
    raw_tier: EnvironmentTier,
    *,
    vix_level: float | None,
) -> EnvironmentTier:
    """Dampen tier improvements using exit bands; worsening tiers apply immediately."""
    if previous_tier is None:
        return raw_tier
    v = _float_or_none(vix_level)
    if v is None:
        return raw_tier
    if _tier_rank(raw_tier) >= _tier_rank(previous_tier):
        return raw_tier

    # Hold crisis until VIX < 30
    if previous_tier == "crisis" and v >= TIER_CRISIS_EXIT:
        return "crisis"
    # Hold stressed until VIX < 27
    if previous_tier == "stressed" and v >= TIER_ELEVATED_EXIT:
        return "stressed"
    # Hold elevated until VIX < 19
    if previous_tier == "elevated" and v >= TIER_NORMAL_EXIT:
        return "elevated"

    # Allowed to improve: at most one tier step toward raw per evaluation
    prev_i = _tier_rank(previous_tier)
    raw_i = _tier_rank(raw_tier)
    step_i = max(raw_i, prev_i - 1)
    return _TIER_ORDER[step_i]


def resolve_environment_tier(
    *,
    vix_level: float | None,
    vix_change_pct: float | None = None,
    vix_change_5d_pct: float | None = None,
    previous_tier: EnvironmentTier | None = None,
) -> EnvironmentTier:
    raw = resolve_environment_tier_raw(
        vix_level=vix_level,
        vix_change_pct=vix_change_pct,
        vix_change_5d_pct=vix_change_5d_pct,
    )
    return apply_tier_hysteresis(previous_tier, raw, vix_level=vix_level)


def read_environment_tier_state() -> dict[str, Any] | None:
    from stocvest.data.dashboard_cache import DashboardKeys, read_dashboard_cache

    envelope = read_dashboard_cache(DashboardKeys.ENVIRONMENT_TIER_STATE)
    if not isinstance(envelope, dict):
        return None
    data = envelope.get("data")
    return data if isinstance(data, dict) else None


def write_environment_tier_state(*, environment_tier: str, vix_level: float | None) -> bool:
    from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache

    payload = {
        "environment_tier": environment_tier,
        "vix_level": round(float(vix_level), 2) if vix_level is not None else None,
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "policy_version": ENVIRONMENT_POLICY_VERSION,
    }
    return write_dashboard_cache(
        DashboardKeys.ENVIRONMENT_TIER_STATE,
        payload,
        "market_pulse",
        "swing",
    )


async def fetch_vix_change_5d_pct(
    *,
    current_vix: float | None = None,
) -> float | None:
    """Load recent VIXCLS observations and compute ~5-session percent change."""
    from stocvest.data.fred_client import FREDClient, FRED_VIX_SERIES_ID

    client = FREDClient()
    observations: list[tuple[Any, float]] = []
    try:
        api_key = client._api_key()
        if api_key:
            observations = await client._fetch_recent_valid_observations(
                api_key,
                FRED_VIX_SERIES_ID,
                limit=8,
            )
        else:
            pts = await client._fetch_vixcls_public_csv_points(tail_rows=12)
            observations = list(pts)
    except Exception:
        return None
    return vix_change_5d_pct_from_observations(observations, current_level=current_vix)


def build_market_environment_policy(
    *,
    mode: Mode,
    vix_level: float | None,
    vix_change_pct: float | None = None,
    vix_change_5d_pct: float | None = None,
    vix_direction: str | None = None,
    macro_regime: str | None = None,
    previous_environment_tier: EnvironmentTier | None = None,
    persist_tier_state: bool = False,
) -> dict[str, Any]:
    """Single policy object for composite API, planning gates, and ledger."""
    raw_tier = resolve_environment_tier_raw(
        vix_level=vix_level,
        vix_change_pct=vix_change_pct,
        vix_change_5d_pct=vix_change_5d_pct,
    )
    tier = resolve_environment_tier(
        vix_level=vix_level,
        vix_change_pct=vix_change_pct,
        vix_change_5d_pct=vix_change_5d_pct,
        previous_tier=previous_environment_tier,
    )
    hysteresis_applied = (
        previous_environment_tier is not None
        and tier != raw_tier
        and _tier_rank(tier) < _tier_rank(raw_tier)
    )

    direction = str(vix_direction or "").strip().lower()
    if direction not in ("rising", "falling", "flat"):
        direction = _vix_direction_from_change(vix_change_pct)

    if tier == "crisis":
        new_swing = False
        new_day = False
        min_rr_swing = 3.0
        min_rr_day = 2.0
        target_policy: TargetPolicy = "t1_only"
        size_guidance: SizeGuidance = "minimal"
        headline = (
            f"Crisis environment (VIX {vix_level:.1f}) — no new swing or day validation entries; plan to T1 only."
            if vix_level is not None
            else "Crisis environment — no new swing or day validation entries; plan to T1 only."
        )
    elif tier == "stressed":
        new_swing = False
        new_day = True
        min_rr_swing = 3.0
        min_rr_day = 1.8
        target_policy = "t1_only"
        size_guidance = "reduced"
        headline = (
            f"Stressed environment (VIX {vix_level:.1f}) — pause new swing entries; day trades need stronger R/R; T1 targets only."
            if vix_level is not None
            else "Stressed environment — pause new swing entries; T1 targets only."
        )
    elif tier == "elevated":
        new_swing = True
        new_day = True
        min_rr_swing = 3.0
        min_rr_day = 1.8
        target_policy = "t1_preferred"
        size_guidance = "reduced"
        headline = (
            f"Elevated volatility (VIX {vix_level:.1f}) — swing ledger requires ≥3:1 R/R; prefer T1 over T2 extensions."
            if vix_level is not None
            else "Elevated volatility — swing ledger requires ≥3:1 R/R; prefer T1 over T2 extensions."
        )
    else:
        new_swing = True
        new_day = True
        min_rr_swing = 2.0
        min_rr_day = 1.3
        target_policy = "t1_and_t2"
        size_guidance = "full"
        headline = (
            f"Normal environment (VIX {vix_level:.1f}) — standard desk R/R and target rules apply."
            if vix_level is not None
            else "Normal environment — standard desk R/R and target rules apply."
        )

    if hysteresis_applied:
        headline = f"{headline} Tier held above raw reading ({raw_tier}) via hysteresis."

    chg5 = _float_or_none(vix_change_5d_pct)
    if chg5 is not None and chg5 >= SPIKE_5D_CHANGE_PCT:
        headline = f"{headline} VIX +{chg5:.1f}% over ~5 sessions."

    min_rr = min_rr_day if mode == "day" else min_rr_swing
    ledger_environment_pass = new_day if mode == "day" else new_swing

    reg = str(macro_regime or "neutral").strip()
    if reg.lower() == "avoid":
        headline = f"{headline} Macro regime is AVOID — extra caution."

    if persist_tier_state:
        write_environment_tier_state(environment_tier=tier, vix_level=vix_level)

    return {
        "policy_version": ENVIRONMENT_POLICY_VERSION,
        "environment_tier": tier,
        "environment_tier_raw": raw_tier,
        "hysteresis_applied": hysteresis_applied,
        "vix_level": round(float(vix_level), 2) if vix_level is not None else None,
        "vix_direction": direction,
        "vix_change_pct": round(float(vix_change_pct), 2) if vix_change_pct is not None else None,
        "vix_change_5d_pct": chg5,
        "macro_regime": reg or "neutral",
        "mode": mode,
        "new_swing_allowed": new_swing,
        "new_day_allowed": new_day,
        "min_rr_swing": min_rr_swing,
        "min_rr_day": min_rr_day,
        "min_rr": min_rr,
        "target_policy": target_policy,
        "size_guidance": size_guidance,
        "headline": headline,
        "ledger_environment_pass": ledger_environment_pass,
    }


def min_risk_reward_from_environment(market_environment: dict[str, Any] | None, *, mode: Mode) -> float:
    if isinstance(market_environment, dict):
        key = "min_rr_day" if mode == "day" else "min_rr_swing"
        v = _float_or_none(market_environment.get(key))
        if v is not None:
            return v
        v2 = _float_or_none(market_environment.get("min_rr"))
        if v2 is not None:
            return v2
    from stocvest.api.services.signal_validation_eligibility import (
        MIN_RISK_REWARD_DAY,
        MIN_RISK_REWARD_SWING,
    )

    return MIN_RISK_REWARD_DAY if mode == "day" else MIN_RISK_REWARD_SWING


def target_policy_from_environment(market_environment: dict[str, Any] | None) -> TargetPolicy:
    if isinstance(market_environment, dict):
        tp = str(market_environment.get("target_policy") or "").strip().lower()
        if tp in ("t1_and_t2", "t1_preferred", "t1_only"):
            return tp  # type: ignore[return-value]
    return "t1_and_t2"


def suppress_reference_target_2(target_policy: TargetPolicy) -> bool:
    return target_policy == "t1_only"


def legacy_conditions_label(
    *,
    environment_tier: EnvironmentTier,
    regime: str,
    spy_pct: float | None,
) -> str:
    """Map VIX tier + regime to legacy FAVORABLE / CHOPPY / AVOID (morning brief UI)."""
    if environment_tier in ("crisis", "stressed"):
        return "AVOID"
    if environment_tier == "elevated":
        return "CHOPPY"
    r = str(regime or "").strip()
    spy = float(spy_pct) if spy_pct is not None else 0.0
    if r == "Bearish" or (spy_pct is not None and spy < -1.0):
        return "AVOID"
    if r == "Bullish" and environment_tier == "normal" and spy > 0.0:
        return "FAVORABLE"
    return "CHOPPY"


def assistant_environment_summary(market_environment: dict[str, Any] | None) -> str | None:
    if not isinstance(market_environment, dict):
        return None
    headline = str(market_environment.get("headline") or "").strip()
    if headline:
        return headline
    tier = str(market_environment.get("environment_tier") or "normal")
    vix = market_environment.get("vix_level")
    if isinstance(vix, (int, float)):
        return f"Market environment {tier} (VIX {float(vix):.1f})."
    return f"Market environment {tier}."


def build_market_environment_from_macro(
    *,
    mode: Mode,
    macro: Any,
    vix_snap: Any = None,
    vix_change_5d_pct: float | None = None,
) -> dict[str, Any]:
    """Build policy from ``MacroAnalyzer`` output and optional VIX snapshot."""
    from stocvest.data.vix_snapshot import vix_level_from_snapshot

    state = read_environment_tier_state()
    prev_raw = str(state.get("environment_tier") or "").strip().lower() if state else ""
    previous: EnvironmentTier | None = None
    if prev_raw in _TIER_ORDER:
        previous = prev_raw  # type: ignore[assignment]

    vix_level = _float_or_none(getattr(macro, "vix_price", None))
    if vix_level is None and vix_snap is not None:
        vix_level = vix_level_from_snapshot(vix_snap)
    vix_chg: float | None = None
    if vix_snap is not None:
        vix_chg = _float_or_none(getattr(vix_snap, "change_percent", None))
    vix_direction = getattr(macro, "vix_trend", None)
    macro_regime = str(getattr(macro, "market_regime", None) or "neutral")
    return build_market_environment_policy(
        mode=mode,
        vix_level=vix_level,
        vix_change_pct=vix_chg,
        vix_change_5d_pct=vix_change_5d_pct,
        vix_direction=str(vix_direction) if vix_direction else None,
        macro_regime=macro_regime,
        previous_environment_tier=previous,
        persist_tier_state=False,
    )


def environment_for_ledger_gate(
    market_environment: dict[str, Any] | None, *, mode: Mode
) -> tuple[bool, str]:
    """Whether environment allows new ledger entries for this mode."""
    if not isinstance(market_environment, dict):
        return True, "environment_unspecified"
    if mode == "day":
        allowed = bool(market_environment.get("new_day_allowed", True))
        tier = str(market_environment.get("environment_tier") or "normal")
        return allowed, f"new_day_allowed_{tier}"
    allowed = bool(market_environment.get("new_swing_allowed", True))
    tier = str(market_environment.get("environment_tier") or "normal")
    return allowed, f"new_swing_allowed_{tier}"

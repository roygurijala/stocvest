"""Execution-ready gate: ledger qualification + price inside entry zone.

``execution_actionable`` is the user-facing "enter now" state. It requires all
validation-ledger quality gates *and* current price within the served entry zone
with headline R/R already reflected in ``risk_reward`` (computed at ``last``).
"""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.services.market_environment import min_risk_reward_from_environment
from stocvest.api.services.signal_validation_eligibility import (
    DECISION_STATE_ACTIONABLE,
    DECISION_STATE_BLOCKED,
    DECISION_STATE_MONITOR,
    evaluate_day_ledger_entry,
    evaluate_swing_ledger_entry,
    sector_analyzer_score_from_body,
)
from stocvest.signals.composite_score import CompositeVerdict

Mode = Literal["day", "swing"]


def _float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f and f > 0 else None
    except (TypeError, ValueError):
        return None


def _entry_zone_from_body(body: dict[str, Any]) -> tuple[float, float] | None:
    for key in ("historical_entry_zone", "session_entry_zone"):
        raw = body.get(key)
        if not isinstance(raw, dict):
            continue
        lo = _float_or_none(raw.get("low"))
        hi = _float_or_none(raw.get("high"))
        if lo is not None and hi is not None and hi > lo:
            return lo, hi
    return None


def price_from_body(body: dict[str, Any]) -> float | None:
    snap = body.get("snapshot")
    if isinstance(snap, dict):
        p = _float_or_none(snap.get("last_trade_price"))
        if p is not None:
            return p
    for key in ("last_trade_price", "price_at_signal"):
        p = _float_or_none(body.get(key))
        if p is not None:
            return p
    return None


def price_in_entry_zone(price: float, zone_low: float, zone_high: float) -> bool:
    return zone_low <= price <= zone_high


def verdict_from_body(body: dict[str, Any]) -> CompositeVerdict:
    raw = body.get("verdict") or body.get("signal_summary")
    if raw is None:
        return CompositeVerdict.NEUTRAL
    s = str(raw).strip().lower()
    if s in ("bullish", "bull"):
        return CompositeVerdict.BULLISH
    if s in ("bearish", "bear"):
        return CompositeVerdict.BEARISH
    try:
        return CompositeVerdict(str(raw).strip().lower())
    except ValueError:
        return CompositeVerdict.NEUTRAL


def _layer_scores_from_body(body: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    layers = body.get("layers")
    if not isinstance(layers, list):
        return out
    for row in layers:
        if not isinstance(row, dict):
            continue
        layer = str(row.get("layer") or "").strip()
        score = row.get("score")
        if not layer:
            continue
        try:
            out[layer] = float(score)
        except (TypeError, ValueError):
            continue
    return out


def evaluate_entry_zone_gate(body: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    price = price_from_body(body)
    zone = _entry_zone_from_body(body)
    if price is None:
        return False, {"pass": False, "reason": "missing_price"}
    if zone is None:
        return False, {"pass": False, "reason": "missing_entry_zone", "price": price}
    lo, hi = zone
    inside = price_in_entry_zone(price, lo, hi)
    return inside, {
        "pass": inside,
        "price": round(price, 4),
        "zone_low": round(lo, 4),
        "zone_high": round(hi, 4),
    }


def evaluate_ledger_gates(
    body: dict[str, Any],
    *,
    mode: Mode,
    verdict: CompositeVerdict | None = None,
    composite_score: float | None = None,
    alignment_ratio: float | None = None,
    macro_market_regime: str | None = None,
    layer_scores: dict[str, float] | None = None,
    sector_layer_score: float | None = None,
    market_environment: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Run swing/day ledger gate evaluation from a composite response body."""
    v = verdict if verdict is not None else verdict_from_body(body)
    score_raw = composite_score if composite_score is not None else body.get("composite_score")
    if score_raw is None and body.get("signal_score") is not None:
        try:
            score_raw = (float(body["signal_score"]) / 50.0) - 1.0
        except (TypeError, ValueError):
            score_raw = 0.0
    try:
        c_score = float(score_raw if score_raw is not None else 0.0)
    except (TypeError, ValueError):
        c_score = 0.0

    ar_raw = alignment_ratio if alignment_ratio is not None else body.get("alignment_ratio")
    try:
        ar = float(ar_raw if ar_raw is not None else 0.0)
    except (TypeError, ValueError):
        ar = 0.0

    macro = macro_market_regime or str(body.get("market_regime") or "neutral")
    env = market_environment if market_environment is not None else body.get("market_environment")
    if not isinstance(env, dict):
        env = None

    rr_raw = body.get("risk_reward")
    rr: float | None = None
    if isinstance(rr_raw, (int, float)):
        rr = float(rr_raw)

    layers = layer_scores if layer_scores is not None else _layer_scores_from_body(body)
    sector = (
        sector_layer_score
        if sector_layer_score is not None
        else sector_analyzer_score_from_body(body)
    )

    status = str(body.get("status") or "active")
    if mode == "day":
        ibc = int(body.get("intraday_bar_count") or body.get("bar_count") or 0)
        orb = str(body.get("orb_signal") or "").strip() or None
        vwap = str(body.get("vwap_state") or "").strip() or None
        return evaluate_day_ledger_entry(
            response_status=status,
            verdict=v,
            composite_score=c_score,
            alignment_ratio=ar,
            macro_market_regime=macro,
            risk_reward=rr,
            intraday_bar_count=ibc,
            orb_signal=orb,
            vwap_state=vwap,
            market_environment=env,
        )
    return evaluate_swing_ledger_entry(
        response_status=status,
        verdict=v,
        composite_score=c_score,
        alignment_ratio=ar,
        macro_market_regime=macro,
        risk_reward=rr,
        layer_scores=layers,
        sector_layer_score=sector,
        market_environment=env,
    )


def evaluate_execution_actionable(
    body: dict[str, Any],
    *,
    mode: Mode,
    verdict: CompositeVerdict | None = None,
) -> tuple[bool, bool, dict[str, Any]]:
    """
    Returns ``(ledger_qualified, execution_actionable, gates)``.

    ``execution_actionable`` requires ledger gates **and** price inside entry zone.
    """
    ledger_ok, gates = evaluate_ledger_gates(body, mode=mode, verdict=verdict)
    zone_ok, zone_gate = evaluate_entry_zone_gate(body)
    gates["entry_zone"] = zone_gate
    execution_ok = ledger_ok and zone_ok
    gates["execution_actionable"] = {"pass": execution_ok, "ledger_qualified": ledger_ok, "in_entry_zone": zone_ok}
    return ledger_ok, execution_ok, gates


def resolve_decision_state(
    body: dict[str, Any],
    *,
    execution_actionable: bool,
    ledger_qualified: bool,
    verdict: CompositeVerdict | None = None,
) -> str:
    st = str(body.get("status") or "").strip().lower()
    if st in ("insufficient_data", "incomplete"):
        return DECISION_STATE_BLOCKED
    if st != "active":
        return DECISION_STATE_BLOCKED
    v = verdict if verdict is not None else verdict_from_body(body)
    if execution_actionable:
        return DECISION_STATE_ACTIONABLE
    if v == CompositeVerdict.NEUTRAL:
        return DECISION_STATE_MONITOR
    if not ledger_qualified:
        return DECISION_STATE_BLOCKED
    return DECISION_STATE_MONITOR


def apply_entry_gates_to_response_body(body: dict[str, Any], *, mode: Mode) -> dict[str, Any]:
    """Mutate ``body`` with ``ledger_qualified``, ``execution_actionable``, ``gate_status``, ``decision_state``."""
    if body.get("error"):
        body["ledger_qualified"] = False
        body["execution_actionable"] = False
        body["decision_state"] = DECISION_STATE_BLOCKED
        return body

    verdict = verdict_from_body(body)
    ledger_ok, execution_ok, gates = evaluate_execution_actionable(body, mode=mode, verdict=verdict)
    existing = body.get("gate_status")
    if isinstance(existing, dict) and existing:
        merged = dict(existing)
        merged.update(gates)
        gates = merged

    body["ledger_qualified"] = ledger_ok
    body["execution_actionable"] = execution_ok
    body["gate_status"] = gates
    body["decision_state"] = resolve_decision_state(
        body,
        execution_actionable=execution_ok,
        ledger_qualified=ledger_ok,
        verdict=verdict,
    )
    min_rr = min_risk_reward_from_environment(
        body.get("market_environment") if isinstance(body.get("market_environment"), dict) else None,
        mode=mode,
    )
    body["min_rr_desk"] = min_rr
    return body


def _pattern_slug_from_body(body: dict[str, Any]) -> str:
    raw = body.get("pattern")
    if raw:
        return str(raw).strip()
    confirms = body.get("confirming_signals")
    if isinstance(confirms, list):
        slugs: list[str] = []
        for row in confirms:
            if not isinstance(row, dict):
                continue
            slug = str(row.get("slug") or row.get("id") or row.get("signal") or "").strip()
            if slug:
                slugs.append(slug)
        if slugs:
            return " ".join(slugs)
    setup = body.get("setup_judgment")
    if isinstance(setup, dict):
        label = str(setup.get("primary_label") or setup.get("headline") or "").strip()
        if label:
            return label
    return "swing_composite" if body.get("mode") == "swing" else "intraday_setup"


def _strength_from_body(body: dict[str, Any]) -> int:
    raw = body.get("signal_score")
    if raw is None:
        raw = body.get("signal_strength")
    if raw is None:
        return 0
    try:
        score = float(raw)
    except (TypeError, ValueError):
        return 0
    if 0.0 <= score <= 1.0:
        score *= 100.0
    return int(round(max(0.0, min(100.0, score))))


def scenario_payload_from_body(body: dict[str, Any], *, mode: Mode, symbol: str) -> dict[str, Any]:
    """Compact scenario dict for execution-actionable alert emails."""
    zone = _entry_zone_from_body(body)
    price = price_from_body(body)
    direction = str(body.get("signal_summary") or body.get("verdict") or "neutral").strip().lower()
    rr = body.get("risk_reward")
    min_rr = body.get("min_rr_desk")
    if min_rr is None:
        min_rr = min_risk_reward_from_environment(
            body.get("market_environment") if isinstance(body.get("market_environment"), dict) else None,
            mode=mode,
        )
    env = body.get("market_environment") if isinstance(body.get("market_environment"), dict) else {}
    strength = _strength_from_body(body)
    pattern = _pattern_slug_from_body(body)
    return {
        "symbol": symbol.strip().upper(),
        "mode": mode,
        "direction": direction,
        "price": price,
        "entry_zone_low": zone[0] if zone else None,
        "entry_zone_high": zone[1] if zone else None,
        "stop": _float_or_none(body.get("reference_stop_level")),
        "target_1": _float_or_none(body.get("reference_target_1")),
        "target_2": _float_or_none(body.get("reference_target_2")),
        "risk_reward": float(rr) if isinstance(rr, (int, float)) else None,
        "min_rr": float(min_rr) if min_rr is not None else None,
        "environment_tier": str(env.get("environment_tier") or "normal"),
        "alignment_ratio": body.get("alignment_ratio"),
        "signal_score": strength,
        "strength": strength,
        "signal_strength": strength,
        "pattern": pattern,
    }

"""Strict entry gates for the signal validation ledger (SignalHistory).

**Where canonical validation rules live**

This module is the single source of truth for *whether a row may enter* the ledger:
enumerations, numeric floors, and gate evaluation used by day/swing composite pipelines.
Human-readable policy text may also appear in product docs; enforcement happens here and
in ``record_signal`` call sites (no user-driven or retroactive inserts).

**Core principles (enforced / reflected in gates)**

- **Actionable only:** rows are evaluated only when ``decision_state == actionable`` (see
  ``derive_decision_state``). Monitor and Blocked outcomes never produce ledger entries.
- **Event-driven:** only composite engines call ``record_signal`` after eligibility; there
  is no API to “add a validation row” from client actions.
- **Logic versioning:** each stored row should carry ``SignalRecord.parameter_version``;
  the public API also exposes this as ``logic_version_id`` for audit language.

**Risk/reward minima (reward:risk)**

- Swing ledger: ``MIN_RISK_REWARD_SWING`` (**2.0** → 2:1).
- Day ledger: ``MIN_RISK_REWARD_DAY`` (**1.3** → 1.3:1).

Immutability after close, discretionary exits, and full hold/exit schedulers are enforced
elsewhere (resolution jobs, future daily swing monitor); entry gates are the scope of this file.
"""

from __future__ import annotations

import json
from typing import Any

from stocvest.signals.composite_score import CompositeVerdict

# Display-scale score: round((composite.score + 1) * 50), same as composite engines.
MIN_ACTIONABLE_SCORE_0_100 = 72
MIN_ALIGNMENT_RATIO = 0.52
MIN_RISK_REWARD_SWING = 2.0
MIN_RISK_REWARD_DAY = 1.3
# Backward-compatible name for swing-oriented call sites / evidence copy.
MIN_RISK_REWARD = MIN_RISK_REWARD_SWING
MIN_SECTOR_LAYER_SCORE = 45.0
MIN_DAY_INTRADAY_BARS = 20

DECISION_STATE_ACTIONABLE = "actionable"
DECISION_STATE_MONITOR = "monitor"
DECISION_STATE_BLOCKED = "blocked"


def derive_decision_state(*, response_status: str, verdict: CompositeVerdict) -> str:
    """Coarse tri-state from composite status + verdict (Rule 1: ledger requires actionable)."""
    st = str(response_status or "").strip().lower()
    if st in ("insufficient_data", "incomplete"):
        return DECISION_STATE_BLOCKED
    if st != "active":
        return DECISION_STATE_BLOCKED
    if verdict == CompositeVerdict.NEUTRAL:
        return DECISION_STATE_MONITOR
    return DECISION_STATE_ACTIONABLE


def _score_0_100_from_composite(composite_score: float) -> int:
    v = int(round((float(composite_score) + 1.0) * 50.0))
    return max(0, min(100, v))


def evaluate_swing_ledger_entry(
    *,
    response_status: str,
    verdict: CompositeVerdict,
    composite_score: float,
    alignment_ratio: float,
    macro_market_regime: str,
    risk_reward: float | None,
    layer_scores: dict[str, float],
) -> tuple[bool, dict[str, Any]]:
    """Swing: multi-day framing; R/R minimum ``MIN_RISK_REWARD_SWING``."""
    gates: dict[str, Any] = {}
    ds = derive_decision_state(response_status=response_status, verdict=verdict)
    gates["decision_state"] = {
        "pass": ds == DECISION_STATE_ACTIONABLE,
        "value": ds,
        "need": DECISION_STATE_ACTIONABLE,
    }
    if ds != DECISION_STATE_ACTIONABLE:
        return False, gates

    ok = True
    min_rr = MIN_RISK_REWARD_SWING

    s100 = _score_0_100_from_composite(composite_score)
    if s100 < MIN_ACTIONABLE_SCORE_0_100:
        gates["decision_score"] = {"pass": False, "value": s100, "min": MIN_ACTIONABLE_SCORE_0_100}
        ok = False
    else:
        gates["decision_score"] = {"pass": True, "value": s100}

    ar = float(alignment_ratio)
    if ar < MIN_ALIGNMENT_RATIO:
        gates["alignment"] = {"pass": False, "value": round(ar, 3), "min": MIN_ALIGNMENT_RATIO}
        ok = False
    else:
        gates["alignment"] = {"pass": True, "value": round(ar, 3)}

    regime = str(macro_market_regime or "").strip().lower()
    if regime == "avoid":
        gates["macro_regime"] = {"pass": False, "value": macro_market_regime, "blocked": "avoid"}
        ok = False
    else:
        gates["macro_regime"] = {"pass": True, "value": macro_market_regime}

    if risk_reward is not None and float(risk_reward) < min_rr:
        gates["risk_reward"] = {"pass": False, "value": float(risk_reward), "min": min_rr}
        ok = False
    elif risk_reward is None:
        gates["risk_reward"] = {"pass": False, "value": None, "reason": "missing_risk_reward"}
        ok = False
    else:
        gates["risk_reward"] = {"pass": True, "value": float(risk_reward)}

    raw = {str(k).lower(): float(v) for k, v in layer_scores.items()}
    sec = raw.get("sector")
    if sec is not None and sec < MIN_SECTOR_LAYER_SCORE:
        gates["sector_gate"] = {"pass": False, "value": sec, "min": MIN_SECTOR_LAYER_SCORE}
        ok = False
    else:
        gates["sector_gate"] = {"pass": True, "value": sec}

    return ok, gates


def evaluate_day_ledger_entry(
    *,
    response_status: str,
    verdict: CompositeVerdict,
    composite_score: float,
    alignment_ratio: float,
    macro_market_regime: str,
    risk_reward: float | None,
    intraday_bar_count: int,
    orb_signal: str | None,
    vwap_state: str | None,
) -> tuple[bool, dict[str, Any]]:
    """Day: intraday structure plus shared gates; R/R minimum ``MIN_RISK_REWARD_DAY``."""
    gates: dict[str, Any] = {}
    ds = derive_decision_state(response_status=response_status, verdict=verdict)
    gates["decision_state"] = {
        "pass": ds == DECISION_STATE_ACTIONABLE,
        "value": ds,
        "need": DECISION_STATE_ACTIONABLE,
    }
    if ds != DECISION_STATE_ACTIONABLE:
        return False, gates

    ok = True
    min_rr = MIN_RISK_REWARD_DAY

    s100 = _score_0_100_from_composite(composite_score)
    if s100 < MIN_ACTIONABLE_SCORE_0_100:
        gates["decision_score"] = {"pass": False, "value": s100, "min": MIN_ACTIONABLE_SCORE_0_100}
        ok = False
    else:
        gates["decision_score"] = {"pass": True, "value": s100}

    ar = float(alignment_ratio)
    if ar < MIN_ALIGNMENT_RATIO:
        gates["alignment"] = {"pass": False, "value": round(ar, 3), "min": MIN_ALIGNMENT_RATIO}
        ok = False
    else:
        gates["alignment"] = {"pass": True, "value": round(ar, 3)}

    regime = str(macro_market_regime or "").strip().lower()
    if regime == "avoid":
        gates["macro_regime"] = {"pass": False, "value": macro_market_regime, "blocked": "avoid"}
        ok = False
    else:
        gates["macro_regime"] = {"pass": True, "value": macro_market_regime}

    if risk_reward is not None and float(risk_reward) < min_rr:
        gates["risk_reward"] = {"pass": False, "value": float(risk_reward), "min": min_rr}
        ok = False
    elif risk_reward is None:
        gates["risk_reward"] = {"pass": False, "value": None, "reason": "missing_risk_reward"}
        ok = False
    else:
        gates["risk_reward"] = {"pass": True, "value": float(risk_reward)}

    ibc = int(intraday_bar_count)
    if ibc < MIN_DAY_INTRADAY_BARS:
        gates["intraday_depth"] = {"pass": False, "bars": ibc, "min": MIN_DAY_INTRADAY_BARS}
        ok = False
    else:
        gates["intraday_depth"] = {"pass": True, "bars": ibc}

    orb = str(orb_signal or "").strip()
    vwap = str(vwap_state or "").strip()
    setup_ok = bool(orb) or bool(vwap)
    if not setup_ok:
        gates["session_setup"] = {"pass": False, "orb_signal": orb or None, "vwap_state": vwap or None}
        ok = False
    else:
        gates["session_setup"] = {"pass": True, "orb_signal": orb or None, "vwap_state": vwap or None}

    return ok, gates


def gate_blob_json(
    gates: dict[str, Any],
    *,
    qualified: bool,
    execution_quality: dict[str, Any] | None = None,
    evaluation_source: str | None = None,
) -> str:
    """Serialize gate outcome; optional study fields for Phase 1/2 audit rows."""
    blob: dict[str, Any] = {"qualified": qualified, "gates": gates}
    if execution_quality is not None:
        blob["execution_quality"] = execution_quality
    if evaluation_source:
        blob["evaluation_source"] = evaluation_source
    return json.dumps(blob, separators=(",", ":"))


def entry_rationale_from_gates(qualified: bool, mode: str) -> str:
    if not qualified:
        return f"{mode} ledger gates not satisfied — row not logged."
    return f"{mode} actionable decision: validation gates passed (score, alignment, regime, R/R, structure)."


def resolve_exit_rule_and_reason(*, horizon: str, mode: str) -> tuple[str, str]:
    """Rule-based exit labeling when D1 horizon resolution completes."""
    if horizon == "1h":
        return "session_horizon_1h", "1h direction checkpoint (session validation)"
    return "session_horizon_1d", "Daily direction checkpoint (swing validation)"

"""Study-oriented ledger gate persistence (scheduled capture + full gate telemetry)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

from stocvest.api.services.execution_quality import build_execution_quality_payload
from stocvest.api.services.ledger_gate_attempt import persist_ledger_gate_attempt
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.services.signal_validation_eligibility import (
    evaluate_day_ledger_entry,
    evaluate_swing_ledger_entry,
    entry_rationale_from_gates,
    gate_blob_json,
)
from stocvest.api.services.validation_timing import (
    MIN_SESSION_VOLUME_SHARES_DAY_LEDGER,
    build_regime_window_key,
    is_day_ledger_entry_session_et,
    is_swing_ledger_entry_window_et,
)
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.models import SignalRecord
from stocvest.signals.composite_score import CompositeVerdict
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_EVAL_SOURCE_LEDGER_CAPTURE = "ledger_capture"
_EVAL_SOURCE_ON_DEMAND = "on_demand"


def evaluation_source_for_ledger_capture(ledger_capture: bool) -> str | None:
    return _EVAL_SOURCE_LEDGER_CAPTURE if ledger_capture else _EVAL_SOURCE_ON_DEMAND


def maybe_persist_ledger_study_row(
    *,
    ledger_capture: bool,
    user_id: str | None,
    mode: str,
    symbol: str,
    response_status: str,
    verdict: CompositeVerdict,
    composite_score: float,
    alignment_ratio: float,
    macro_market_regime: str,
    risk_reward: float | None,
    price_at_signal: float | None,
    layer_scores: dict[str, float],
    signal_strength: int,
    pattern: str,
    params: SignalParameters,
    snapshot_blobs: dict[str, str | None],
    layer_scores_json: str | None,
    setup_type: str | None,
    stop_level: float | None,
    reference_structure_level: float | None,
    regime_label: str,
    sector_label: str,
    vwap_state_at_entry: str | None,
    # day-only
    intraday_bar_count: int = 0,
    orb_signal: str | None = None,
    vwap_state: str | None = None,
    day_volume: float | None = None,
    atr: float | None = None,
    volume_ratio: float | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Persist qualified or shadow row when ``ledger_capture`` or normal directional persist ran.

    Returns ``(eligible, gates)`` and sets whether a row was written. When ``ledger_capture`` is
    True, also writes shadow rows for neutral/monitor/blocked setups (no bullish/bearish verdict).
    """
    if not user_id:
        return False, {}
    if not ledger_capture and verdict == CompositeVerdict.NEUTRAL:
        return False, {}
    if price_at_signal is None or float(price_at_signal) <= 0:
        if not ledger_capture:
            return False, {}
        price_at_signal = 0.01  # placeholder so study row still records gate outcome

    gen_at = datetime.now(timezone.utc)
    if mode == "day":
        eligible, gates = evaluate_day_ledger_entry(
            response_status=response_status,
            verdict=verdict,
            composite_score=composite_score,
            alignment_ratio=alignment_ratio,
            macro_market_regime=macro_market_regime,
            risk_reward=risk_reward,
            intraday_bar_count=intraday_bar_count,
            orb_signal=orb_signal,
            vwap_state=vwap_state,
        )
        if eligible:
            if not is_day_ledger_entry_session_et(gen_at):
                eligible = False
                gates["entry_session_timing"] = {
                    "pass": False,
                    "need": "us_regular_session_only",
                }
            else:
                dv = float(day_volume or 0.0)
                if dv < MIN_SESSION_VOLUME_SHARES_DAY_LEDGER:
                    eligible = False
                    gates["session_liquidity"] = {
                        "pass": False,
                        "day_volume": dv,
                        "min": MIN_SESSION_VOLUME_SHARES_DAY_LEDGER,
                    }
            if eligible:
                if get_signal_recorder().has_open_validation_position(user_id, symbol, "day"):
                    eligible = False
                    gates["dedupe_open_position"] = {
                        "pass": False,
                        "reason": "one_open_validation_per_symbol_mode",
                    }
    else:
        eligible, gates = evaluate_swing_ledger_entry(
            response_status=response_status,
            verdict=verdict,
            composite_score=composite_score,
            alignment_ratio=alignment_ratio,
            macro_market_regime=macro_market_regime,
            risk_reward=risk_reward,
            layer_scores=layer_scores,
        )
        if eligible:
            if not is_swing_ledger_entry_window_et(gen_at):
                eligible = False
                gates["entry_daily_close_window"] = {
                    "pass": False,
                    "need": "post_regular_close_window_et",
                }
            elif get_signal_recorder().has_open_validation_position(user_id, symbol, "swing"):
                eligible = False
                gates["dedupe_open_position"] = {
                    "pass": False,
                    "reason": "one_open_validation_per_symbol_mode",
                }

    eq = build_execution_quality_payload(
        mode="day" if mode == "day" else "swing",
        price_at_signal=float(price_at_signal) if price_at_signal else None,
        reference_stop_level=stop_level,
        reference_target_1=reference_structure_level,
        risk_reward=risk_reward,
        atr=atr,
        volume_ratio=volume_ratio,
        orb_signal=orb_signal,
        vwap_state=vwap_state or vwap_state_at_entry,
        ref_utc=gen_at,
    )
    eval_src = evaluation_source_for_ledger_capture(ledger_capture)
    ny_date = gen_at.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    rwk = build_regime_window_key(str(macro_market_regime or "neutral"), gen_at)
    record = SignalRecord(
        signal_id=str(uuid4()),
        symbol=symbol,
        direction=str(verdict.value),
        signal_strength=signal_strength,
        pattern=pattern,
        layer_scores=layer_scores,
        price_at_signal=float(price_at_signal),
        generated_at=gen_at,
        user_id=user_id,
        parameter_version=params.version,
        technical_snapshot_json=snapshot_blobs.get("technical_snapshot_json"),
        news_snapshot_json=snapshot_blobs.get("news_snapshot_json"),
        macro_snapshot_json=snapshot_blobs.get("macro_snapshot_json"),
        sector_snapshot_json=snapshot_blobs.get("sector_snapshot_json"),
        internals_snapshot_json=snapshot_blobs.get("internals_snapshot_json"),
        layer_scores_json=layer_scores_json or snapshot_blobs.get("layer_scores_json"),
        status=response_status if response_status in ("active", "incomplete") else "active",
        mode="day" if mode == "day" else "swing",
        ledger_qualified=eligible,
        gate_status_json=gate_blob_json(
            gates,
            qualified=eligible,
            execution_quality=eq,
            evaluation_source=eval_src,
        ),
        entry_rationale=entry_rationale_from_gates(eligible, mode),
        decision_state_entry="actionable" if eligible else None,
        ledger_entry_date_et=ny_date if eligible else None,
        setup_type=setup_type,
        stop_level=stop_level,
        reference_structure_level=reference_structure_level,
        regime_label_at_entry=regime_label,
        sector_label_at_entry=sector_label,
        vwap_state_at_entry=vwap_state_at_entry,
        regime_window_key=rwk,
        ledger_position_open=bool(eligible),
    )
    persist_ledger_gate_attempt(record, ledger_capture=ledger_capture, mode=mode)
    return eligible, gates

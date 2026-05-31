from __future__ import annotations

import json
import math
from datetime import datetime, timezone

from stocvest.data.models import SignalRecord
from stocvest.signals.environment_policy_backtest import (
    PRODUCTION_BANDS,
    BacktestRow,
    EnvironmentBandConfig,
    candidate_metrics_to_dict,
    evaluate_candidate,
    extract_backtest_row,
    rank_candidates,
    resolve_tier_raw_for_config,
    run_grid_search,
)


def _record(
    *,
    vix: float,
    tier: str,
    outcome_1d: str = "correct",
    mode: str = "swing",
    qualified: bool = True,
) -> SignalRecord:
    blob = json.dumps(
        {
            "qualified": qualified,
            "gates": {"market_environment": {"pass": tier != "crisis", "tier": tier}},
            "market_environment_audit": {
                "policy_version": "env_policy_v2",
                "environment_tier": tier,
                "vix_level": vix,
            },
        }
    )
    return SignalRecord(
        signal_id="s1",
        symbol="TEST",
        direction="bullish",
        signal_strength=80,
        pattern="swing_composite",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=datetime(2026, 1, 15, tzinfo=timezone.utc),
        outcome_1d=outcome_1d,
        mode=mode,
        ledger_qualified=qualified,
        gate_status_json=blob,
    )


def test_resolve_tier_raw_matches_production_bands() -> None:
    assert resolve_tier_raw_for_config(vix_level=17.0, config=PRODUCTION_BANDS) == "normal"
    assert resolve_tier_raw_for_config(vix_level=24.0, config=PRODUCTION_BANDS) == "elevated"
    assert resolve_tier_raw_for_config(vix_level=30.0, config=PRODUCTION_BANDS) == "stressed"
    assert resolve_tier_raw_for_config(vix_level=33.0, config=PRODUCTION_BANDS) == "crisis"


def test_stricter_elevated_band_blocks_more_swings() -> None:
    rows = [
        BacktestRow("a", "swing", 27.0, None, None, "elevated", True, None, "correct"),
        BacktestRow("b", "swing", 27.0, None, None, "elevated", True, None, "incorrect"),
    ]
    loose = evaluate_candidate(rows, config=PRODUCTION_BANDS, horizon="1d")
    strict = evaluate_candidate(
        rows,
        config=EnvironmentBandConfig(normal_enter=20, elevated_enter=26, crisis_enter=32),
        horizon="1d",
    )
    assert loose.swing_blocked.resolved_directional == 0
    assert strict.swing_blocked.resolved_directional == 2


def test_run_grid_search_includes_production_baseline() -> None:
    recs = [
        _record(vix=18, tier="normal", outcome_1d="correct"),
        _record(vix=29, tier="stressed", outcome_1d="incorrect", qualified=False),
    ]
    rows = [extract_backtest_row(r) for r in recs]
    assert rows[0] is not None
    results = run_grid_search(
        [r for r in rows if r],
        horizon="1d",
        configs=[
            PRODUCTION_BANDS,
            EnvironmentBandConfig(normal_enter=20, elevated_enter=27, crisis_enter=32),
        ],
    )
    assert any(m.config.key() == PRODUCTION_BANDS.key() for m in results)
    ranked = rank_candidates(results, mode="swing")
    assert len(ranked) >= 2


def test_extract_backtest_row_returns_none_without_gate_json() -> None:
    rec = SignalRecord(
        signal_id="x",
        symbol="X",
        direction="bullish",
        signal_strength=50,
        pattern="swing_composite",
        layer_scores={},
        price_at_signal=1.0,
        generated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert extract_backtest_row(rec) is None

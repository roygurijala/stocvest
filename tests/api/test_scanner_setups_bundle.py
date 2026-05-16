"""Scanner setups v2 bundle — near-qualification band."""

from __future__ import annotations

from stocvest.api.services.scanner_setups_bundle import (
    alignment_from_triggers,
    annotate_near_qualification_rows,
    build_near_qualification_candidates,
    bundle_setups_response,
)
from stocvest.signals.day_trading_scanner import IntradaySetupCandidate


def test_build_near_qualification_candidates_filters_band() -> None:
    qual = [
        IntradaySetupCandidate(
            symbol="AAA",
            direction="long",
            score=0.6,
            triggers=["orb_breakout_long"],
            last_price=10.0,
            vwap=10.0,
            ema9=10.0,
            timestamp_iso="2026-05-16T14:00:00+00:00",
        )
    ]
    pool = [
        qual[0],
        IntradaySetupCandidate(
            symbol="BBB",
            direction="long",
            score=0.4,
            triggers=["vwap_reclaim", "ema9_bounce"],
            last_price=20.0,
            vwap=20.0,
            ema9=20.0,
            timestamp_iso="2026-05-16T14:00:00+00:00",
        ),
        IntradaySetupCandidate(
            symbol="CCC",
            direction="long",
            score=0.2,
            triggers=["hod_breakout"],
            last_price=30.0,
            vwap=30.0,
            ema9=30.0,
            timestamp_iso="2026-05-16T14:00:00+00:00",
        ),
    ]
    near = build_near_qualification_candidates(
        pool,
        qualifying_symbols={"AAA"},
        min_score=0.55,
        near_min_score=0.35,
        near_limit=5,
    )
    assert len(near) == 1
    assert near[0].symbol == "BBB"


def test_bundle_setups_response_annotates_near_rows() -> None:
    qual: list[IntradaySetupCandidate] = []
    near = [
        IntradaySetupCandidate(
            symbol="ZZZ",
            direction="long",
            score=0.4,
            triggers=["a", "b"],
            last_price=1.0,
            vwap=1.0,
            ema9=1.0,
            timestamp_iso="2026-05-16T14:00:00+00:00",
        )
    ]

    def serialize(cands: list[IntradaySetupCandidate], _payload: dict) -> list[dict]:
        return [{"symbol": c.symbol, "score": c.score, "triggers": list(c.triggers)} for c in cands]

    out = bundle_setups_response(
        qual,
        near,
        {},
        serialize,
        min_score=0.55,
        near_min_score=0.35,
        near_limit=5,
    )
    assert out["qualifying"] == []
    assert out["near_qualification"][0]["qualification_tier"] == "near"
    assert out["near_qualification"][0]["alignment"]["aligned"] == 2


def test_alignment_from_triggers_label() -> None:
    a = alignment_from_triggers(["x", "y", "z"])
    assert a["label"] == "3/6 aligned"

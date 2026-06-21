"""B71 Phase C — offline news event-study analytics (read-only, signal-co-temporal join)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import NewsEventCapture, NewsSnapshot, TechnicalSnapshot
from stocvest.signals.news_event_study import (
    aggregate_symbol_sensitivity,
    build_event_study_rows,
)

_GEN = datetime(2026, 6, 1, 14, 30, tzinfo=timezone.utc)


def _rec(
    symbol: str,
    idx: int,
    *,
    fwd: float | None = None,
    sentiment: float | None = None,
    has_news: bool = True,
    mode: str = "day",
    atr: float | None = None,
    price: float = 100.0,
    resolved: bool = True,
) -> SignalRecord:
    news_json = None
    if has_news:
        news_json = NewsSnapshot(
            article_count=3,
            weighted_sentiment=sentiment,
            top_events=[NewsEventCapture(published_at="2026-06-01T12:00:00Z", sentiment_score=sentiment)],
        ).model_dump_json()
    tech_json = TechnicalSnapshot(atr=atr).model_dump_json() if atr is not None else None
    price_after = price * (1 + fwd) if fwd is not None else None
    return SignalRecord(
        signal_id=f"{symbol}-{idx}",
        symbol=symbol,
        direction="bullish",
        signal_strength=50,
        price_at_signal=price,
        generated_at=_GEN,
        mode=mode,
        resolved_1d=bool(resolved and fwd is not None),
        price_1d_after=price_after,
        news_snapshot_json=news_json,
        technical_snapshot_json=tech_json,
    )


# ── row extraction ──────────────────────────────────────────────────────────────


@pytest.mark.unit
def test_row_has_news_and_forward_return():
    rows = build_event_study_rows([_rec("AAA", 0, fwd=0.05, sentiment=0.6)])
    assert len(rows) == 1
    r = rows[0]
    assert r.symbol == "AAA" and r.has_news is True
    assert r.news_sentiment == pytest.approx(0.6)
    assert r.fwd_return == pytest.approx(0.05)
    assert r.abs_fwd_return == pytest.approx(0.05)


@pytest.mark.unit
def test_no_news_when_snapshot_absent():
    rows = build_event_study_rows([_rec("AAA", 0, fwd=0.02, has_news=False)])
    assert rows[0].has_news is False
    assert rows[0].news_sentiment is None


@pytest.mark.unit
def test_unresolved_forward_return_is_none():
    rows = build_event_study_rows([_rec("AAA", 0, fwd=0.05, sentiment=0.3, resolved=False)])
    assert rows[0].fwd_return is None
    assert rows[0].abs_fwd_return is None


@pytest.mark.unit
def test_atr_pct_derived_from_technical_snapshot():
    rows = build_event_study_rows([_rec("AAA", 0, fwd=0.01, sentiment=0.1, atr=2.5, price=100.0)])
    assert rows[0].atr_pct == pytest.approx(0.025)


@pytest.mark.unit
def test_malformed_news_json_is_treated_as_no_news():
    rec = _rec("AAA", 0, fwd=0.01, has_news=False)
    rec = rec.model_copy(update={"news_snapshot_json": "{not valid json"})
    rows = build_event_study_rows([rec])
    assert rows[0].has_news is False


@pytest.mark.unit
def test_sentiment_falls_back_to_event_mean_when_aggregate_missing():
    news_json = NewsSnapshot(
        article_count=2,
        weighted_sentiment=None,
        sentiment_score=None,
        top_events=[
            NewsEventCapture(sentiment_score=0.4),
            NewsEventCapture(sentiment_score=0.8),
        ],
    ).model_dump_json()
    rec = _rec("AAA", 0, fwd=0.03, has_news=False).model_copy(update={"news_snapshot_json": news_json})
    rows = build_event_study_rows([rec])
    assert rows[0].has_news is True
    assert rows[0].news_sentiment == pytest.approx(0.6)


# ── aggregation ─────────────────────────────────────────────────────────────────


@pytest.mark.unit
def test_sensitivity_ratio_greater_than_one_when_news_days_move_more():
    recs = [_rec("AAA", i, fwd=0.05, sentiment=0.5) for i in range(8)]  # news: |ret|=0.05
    recs += [_rec("AAA", 100 + i, fwd=0.01, has_news=False) for i in range(4)]  # quiet: |ret|=0.01
    rows = build_event_study_rows(recs)
    agg = aggregate_symbol_sensitivity(rows, min_news_samples=8)
    s = agg["AAA"]
    assert s.n_news_resolved == 8 and s.n_baseline_resolved == 4
    assert s.mean_abs_news == pytest.approx(0.05)
    assert s.mean_abs_baseline == pytest.approx(0.01)
    assert s.sensitivity_ratio == pytest.approx(5.0)


@pytest.mark.unit
def test_predictiveness_counts_sign_agreement():
    # 6 agree (+sent,+ret), 2 disagree (+sent,-ret) → 6/8 = 0.75
    recs = [_rec("AAA", i, fwd=0.04, sentiment=0.5) for i in range(6)]
    recs += [_rec("AAA", 100 + i, fwd=-0.04, sentiment=0.5) for i in range(2)]
    rows = build_event_study_rows(recs)
    s = aggregate_symbol_sensitivity(rows, min_news_samples=8)["AAA"]
    assert s.n_predictive == 8
    assert s.predictiveness == pytest.approx(0.75)


@pytest.mark.unit
def test_predictiveness_excludes_flat_sentiment_and_flat_moves():
    recs = [_rec("AAA", i, fwd=0.04, sentiment=0.5) for i in range(8)]  # directional
    recs += [_rec("AAA", 200 + i, fwd=0.0, sentiment=0.5) for i in range(3)]  # flat move → excluded
    recs += [_rec("AAA", 300 + i, fwd=0.04, sentiment=0.0) for i in range(3)]  # flat sentiment → excluded
    rows = build_event_study_rows(recs)
    s = aggregate_symbol_sensitivity(rows, min_news_samples=8)["AAA"]
    assert s.n_predictive == 8
    assert s.predictiveness == pytest.approx(1.0)


@pytest.mark.unit
def test_min_samples_filters_thin_symbols():
    recs = [_rec("AAA", i, fwd=0.03, sentiment=0.5) for i in range(3)]
    rows = build_event_study_rows(recs)
    assert aggregate_symbol_sensitivity(rows, min_news_samples=8) == {}
    assert "AAA" in aggregate_symbol_sensitivity(rows, min_news_samples=3)


@pytest.mark.unit
def test_ratio_none_when_no_baseline_rows():
    recs = [_rec("AAA", i, fwd=0.03, sentiment=0.5) for i in range(8)]
    s = aggregate_symbol_sensitivity(build_event_study_rows(recs), min_news_samples=8)["AAA"]
    assert s.n_baseline_resolved == 0
    assert s.sensitivity_ratio is None
    assert s.mean_abs_baseline is None

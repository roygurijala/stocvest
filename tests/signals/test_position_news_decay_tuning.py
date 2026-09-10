"""ADR-004 POS-AI-9 — offline news-decay tuner (pure core) tests.

Covers the capture helper, the age→bucket mapping, the freshest-age join, and the
deriver's insufficient-data gating + monotone, clamped recommendation. The tuner
never mutates live constants — these tests assert the *report* only.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import NewsSnapshot, news_snapshot_from_quality_articles
from stocvest.signals.news_sentiment import position_recency_weight
from stocvest.signals.position_news_decay_tuning import (
    AGE_BUCKET_LABELS,
    LIVE_DECAY_BY_BUCKET,
    BucketStat,
    DecaySample,
    aggregate_buckets,
    bucket_for_age_days,
    build_decay_samples,
    derive_recommended_decay,
    freshest_news_age_days,
)

pytestmark = pytest.mark.unit

_NOW = datetime(2026, 2, 1, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Capture helper
# --------------------------------------------------------------------------- #


def test_capture_helper_maps_quality_articles_to_dated_events() -> None:
    arts = [
        {"text": "Record annual revenue", "source": "reuters", "published_at": "2026-01-20T00:00:00Z", "sentiment_score": 0.6},
        {"text": "Guidance raised", "source": "bloomberg", "published_at": "2026-01-05T00:00:00Z", "sentiment_score": 0.4},
    ]
    snap = news_snapshot_from_quality_articles(
        article_count=2,
        weighted_sentiment=0.5,
        catalyst_type="earnings",
        catalyst_headline="Record annual revenue",
        quality_articles=arts,
    )
    assert snap.article_count == 2
    assert [e.published_at for e in snap.top_events] == ["2026-01-20T00:00:00Z", "2026-01-05T00:00:00Z"]
    assert snap.top_events[0].sentiment_score == pytest.approx(0.6)
    # Round-trips through JSON (how it is persisted on the ledger row).
    assert NewsSnapshot.model_validate_json(snap.model_dump_json()).article_count == 2


def test_capture_helper_top_n_and_bad_rows() -> None:
    arts = [{"text": f"h{i}", "published_at": "2026-01-20T00:00:00Z"} for i in range(20)]
    arts.append("not-a-dict")  # type: ignore[arg-type]
    snap = news_snapshot_from_quality_articles(
        article_count=21, weighted_sentiment=None, catalyst_type=None, catalyst_headline=None,
        quality_articles=arts, top_n=5,
    )
    assert len(snap.top_events) == 5


# --------------------------------------------------------------------------- #
# Buckets + live-curve sync
# --------------------------------------------------------------------------- #


def test_bucket_boundaries() -> None:
    assert bucket_for_age_days(0) == "0-7"
    assert bucket_for_age_days(7) == "0-7"
    assert bucket_for_age_days(7.1) == "8-14"
    assert bucket_for_age_days(21) == "15-21"
    assert bucket_for_age_days(30) == "22-30"
    assert bucket_for_age_days(31) == "31+"
    assert bucket_for_age_days(999) == "31+"


def test_live_curve_table_matches_position_recency_weight() -> None:
    """Guards against drift between this module's snapshot and the live function."""
    probes = {"0-7": 3, "8-14": 10, "15-21": 18, "22-30": 26, "31+": 45}
    for label, age in probes.items():
        expected = position_recency_weight(_NOW - timedelta(days=age), _NOW)
        assert LIVE_DECAY_BY_BUCKET[label] == pytest.approx(expected)


# --------------------------------------------------------------------------- #
# Freshest-age join
# --------------------------------------------------------------------------- #


def _position_record(*, news_snapshot_json: str | None, outcome_1d: str | None, generated_at: datetime = _NOW) -> SignalRecord:
    return SignalRecord(
        signal_id="s1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=70,
        pattern="position_composite",
        price_at_signal=100.0,
        generated_at=generated_at,
        mode="position",
        outcome_1d=outcome_1d,
        resolved_1d=outcome_1d is not None,
        news_snapshot_json=news_snapshot_json,
    )


def test_freshest_news_age_picks_the_newest_article() -> None:
    snap = news_snapshot_from_quality_articles(
        article_count=2, weighted_sentiment=0.2, catalyst_type=None, catalyst_headline=None,
        quality_articles=[
            {"text": "old", "published_at": "2026-01-05T00:00:00Z"},   # ~27 days
            {"text": "fresh", "published_at": "2026-01-28T00:00:00Z"},  # ~4 days
        ],
    )
    rec = _position_record(news_snapshot_json=snap.model_dump_json(), outcome_1d="correct")
    age = freshest_news_age_days(rec)
    assert age is not None and 3.5 < age < 4.5  # freshest wins


def test_build_decay_samples_filters_mode_and_neutral() -> None:
    snap = news_snapshot_from_quality_articles(
        article_count=1, weighted_sentiment=0.2, catalyst_type=None, catalyst_headline=None,
        quality_articles=[{"text": "x", "published_at": "2026-01-28T00:00:00Z"}],
    ).model_dump_json()
    good = _position_record(news_snapshot_json=snap, outcome_1d="correct")
    neutral = _position_record(news_snapshot_json=snap, outcome_1d="neutral")
    no_news = _position_record(news_snapshot_json=None, outcome_1d="correct")
    samples = build_decay_samples([good, neutral, no_news])
    assert len(samples) == 1 and samples[0].correct is True


# --------------------------------------------------------------------------- #
# Deriver gating + recommendation shape
# --------------------------------------------------------------------------- #


def _stats(counts: dict[str, tuple[int, int]]) -> dict[str, BucketStat]:
    out = {label: BucketStat(label) for label in AGE_BUCKET_LABELS}
    for label, (c, i) in counts.items():
        out[label].n_correct = c
        out[label].n_incorrect = i
    return out


def test_derive_insufficient_when_reference_thin() -> None:
    res = derive_recommended_decay(_stats({"0-7": (5, 3)}), min_samples=30)
    assert res.status == "insufficient_data"
    assert res.recommended_curve is None


def test_derive_insufficient_when_any_populated_bucket_thin() -> None:
    counts = {"0-7": (40, 20), "8-14": (35, 15), "15-21": (4, 3)}  # 15-21 too thin
    res = derive_recommended_decay(_stats(counts), min_samples=30)
    assert res.status == "insufficient_data"
    assert "15-21" in res.reason


def test_derive_recommendation_is_relative_clamped_and_monotone() -> None:
    # Fresh bucket 70% hit-rate (anchor 1.0); 8-14 at 35% ⇒ ~0.5; empty older buckets
    # fall back to live and are pulled down to stay non-increasing.
    counts = {"0-7": (70, 30), "8-14": (35, 65)}
    res = derive_recommended_decay(_stats(counts), min_samples=30)
    assert res.status == "recommended"
    rec = res.recommended_curve
    assert rec is not None
    assert rec["0-7"] == 1.0
    assert rec["8-14"] == pytest.approx(0.5, abs=0.02)
    # Monotone non-increasing across age.
    weights = [rec[label] for label in AGE_BUCKET_LABELS]
    assert weights == sorted(weights, reverse=True)
    # Never exceeds the freshest anchor, never below the floor.
    assert all(0.10 <= w <= 1.0 for w in weights)


def test_derive_clamps_outperforming_old_bucket_to_one() -> None:
    # An older bucket that "beats" fresh must not be up-weighted above 1.0.
    counts = {"0-7": (50, 50), "8-14": (90, 10)}
    res = derive_recommended_decay(_stats(counts), min_samples=30)
    assert res.recommended_curve is not None
    assert res.recommended_curve["8-14"] <= 1.0

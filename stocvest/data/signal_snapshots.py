"""Structured per-signal snapshots for tuning analysis (stored as JSON on :class:`SignalRecord`)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TechnicalSnapshot(BaseModel):
    rsi: float | None = None
    vwap: float | None = None
    ema9: float | None = None
    ema20: float | None = None
    price_vs_vwap: str | None = None
    price_vs_ema9: str | None = None
    price_vs_ema20: str | None = None
    orb_signal: str | None = None
    orb_high: float | None = None
    orb_low: float | None = None
    volume_ratio: float | None = None
    volume_vs_adv: float | None = None
    atr: float | None = None
    prev_day_high: float | None = None
    prev_day_low: float | None = None
    bars_analyzed: int = 0


class NewsEventCapture(BaseModel):
    """One article-level news event captured at signal time (B71 Phase B).

    Persisted inside ``news_snapshot_json`` so a later event study (B71 Phase C)
    can join each headline's ``published_at`` + per-ticker ``sentiment_score`` to
    the symbol's subsequent price move and learn a data-driven news sensitivity.
    Public market-news metadata only — no user/PII content.
    """

    title: str | None = None
    source: str | None = None
    published_at: str | None = None
    sentiment_score: float | None = None
    sentiment: str | None = None
    catalyst_type: str | None = None
    url: str | None = None


class NewsSnapshot(BaseModel):
    article_count: int = 0
    sentiment_score: float | None = None
    weighted_sentiment: float | None = None
    catalyst_type: str | None = None
    catalyst_headline: str | None = None
    top_sources: list[str] = Field(default_factory=list)
    # B71 Phase B: top article-level events (timestamp + per-ticker sentiment)
    # for retrospective news-impact / sensitivity analysis. Empty pre-B71.
    top_events: list[NewsEventCapture] = Field(default_factory=list)


class MacroSnapshot(BaseModel):
    spy_day_pct: float | None = None
    qqq_day_pct: float | None = None
    vix_price: float | None = None
    vix_day_change_pct: float | None = None
    vix_trend: str | None = None
    market_regime: str | None = None
    economic_event_today: bool = False
    economic_event_name: str | None = None


class SectorSnapshot(BaseModel):
    sector_etf: str | None = None
    sector_day_pct: float | None = None
    sector_vs_spy_pct: float | None = None
    sector_leadership: str | None = None


class InternalsSnapshot(BaseModel):
    vix_price: float | None = None
    breadth_score: float | None = None
    participation: str | None = None


class LayerScoresSnapshot(BaseModel):
    technical_score: int | None = None
    news_score: int | None = None
    macro_score: int | None = None
    sector_score: int | None = None
    geo_score: int | None = None
    internals_score: int | None = None
    technical_verdict: str | None = None
    news_verdict: str | None = None
    macro_verdict: str | None = None
    sector_verdict: str | None = None
    geo_verdict: str | None = None
    internals_verdict: str | None = None
    confluence_confirming: list[str] = Field(default_factory=list)
    confluence_conflicting: list[str] = Field(default_factory=list)


def _score_to_int_0_100(x: float | None) -> int | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return int(round(max(0.0, min(100.0, (v + 1.0) / 2.0 * 100.0))))


def _verdict_from_raw(raw: float | None) -> str | None:
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v >= 0.2:
        return "bullish"
    if v <= -0.2:
        return "bearish"
    return "neutral"


def news_snapshot_from_quality_articles(
    *,
    article_count: int,
    weighted_sentiment: float | None,
    catalyst_type: str | None,
    catalyst_headline: str | None,
    quality_articles: list[dict[str, Any]],
    top_n: int = 12,
) -> NewsSnapshot:
    """Build a :class:`NewsSnapshot` (with dated ``top_events``) from a news layer's
    ``quality_articles`` wire rows (ADR-004 POS-AI-9 capture).

    The Position ledger previously stored no news snapshot, so there was no way to
    join each headline's ``published_at`` to the signal's realized outcome and tune
    the long-horizon recency decay. This captures the same public-market-news
    metadata swing/day already persist (title/source/``published_at``/sentiment) so
    the offline decay-tuning study has data to work with. No prices/PII.
    """
    events: list[NewsEventCapture] = []
    for a in quality_articles[: max(0, int(top_n))]:
        if not isinstance(a, dict):
            continue
        raw_score = a.get("sentiment_score")
        score = float(raw_score) if isinstance(raw_score, (int, float)) else None
        events.append(
            NewsEventCapture(
                title=(str(a["text"]) if a.get("text") else None),
                source=(str(a["source"]) if a.get("source") else None),
                published_at=(str(a["published_at"]) if a.get("published_at") else None),
                sentiment_score=score,
            )
        )
    return NewsSnapshot(
        article_count=int(article_count or 0),
        weighted_sentiment=weighted_sentiment,
        catalyst_type=catalyst_type,
        catalyst_headline=catalyst_headline,
        top_sources=[],
        top_events=events,
    )


def layer_scores_snapshot_from_layer_scores(
    layer_scores: dict[str, float],
    *,
    confirming: list[str] | None = None,
    conflicting: list[str] | None = None,
) -> LayerScoresSnapshot:
    """Map persisted -1..1 layer scores to 0..100 ints + verdict strings."""
    ls = {str(k).strip().lower(): float(v) for k, v in layer_scores.items()}
    geo_raw = ls.get("geopolitical", ls.get("geo"))
    return LayerScoresSnapshot(
        technical_score=_score_to_int_0_100(ls.get("technical")),
        news_score=_score_to_int_0_100(ls.get("news")),
        macro_score=_score_to_int_0_100(ls.get("macro")),
        sector_score=_score_to_int_0_100(ls.get("sector")),
        geo_score=_score_to_int_0_100(geo_raw),
        internals_score=_score_to_int_0_100(ls.get("internals")),
        technical_verdict=_verdict_from_raw(ls.get("technical")),
        news_verdict=_verdict_from_raw(ls.get("news")),
        macro_verdict=_verdict_from_raw(ls.get("macro")),
        sector_verdict=_verdict_from_raw(ls.get("sector")),
        geo_verdict=_verdict_from_raw(geo_raw),
        internals_verdict=_verdict_from_raw(ls.get("internals")),
        confluence_confirming=list(confirming or []),
        confluence_conflicting=list(conflicting or []),
    )

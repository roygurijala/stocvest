"""Shared DTO parsing/serialization for signal and scanner handlers."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from stocvest.data.models import Bar, NewsArticle, Newssentiment, Timeframe
from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.signals import (
    IntradaySetupCandidate,
    NewsCatalystCandidate,
    PDTAssessment,
    PremarketGapCandidate,
)
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields


def parse_bar(item: dict[str, Any], symbol: str) -> Bar:
    timeframe_raw = str(item.get("timeframe") or Timeframe.MIN_1.value)
    return Bar(
        symbol=symbol,
        timestamp=datetime.fromisoformat(str(item["timestamp"])),
        timeframe=Timeframe(timeframe_raw),
        open=float(item["open"]),
        high=float(item["high"]),
        low=float(item["low"]),
        close=float(item["close"]),
        volume=float(item["volume"]),
        vwap=float(item["vwap"]) if item.get("vwap") is not None else None,
        transactions=int(item["transactions"]) if item.get("transactions") is not None else None,
    )


def parse_article(item: dict[str, Any]) -> NewsArticle:
    sentiment_raw = item.get("sentiment")
    sentiment = Newssentiment(str(sentiment_raw)) if sentiment_raw is not None else None
    img_raw = item.get("image_url")
    image_url = str(img_raw).strip() if img_raw is not None else None
    if image_url == "":
        image_url = None
    return NewsArticle(
        article_id=str(item["article_id"]),
        published_at=datetime.fromisoformat(str(item["published_at"])),
        title=str(item["title"]),
        description=str(item["description"]) if item.get("description") is not None else None,
        image_url=image_url,
        url=str(item["url"]),
        source=str(item["source"]) if item.get("source") is not None else None,
        tickers=[str(x) for x in item.get("tickers", [])],
        keywords=[str(x) for x in item.get("keywords", [])],
        sentiment=sentiment,
        sentiment_score=float(item["sentiment_score"]) if item.get("sentiment_score") is not None else None,
        company_name=str(item["company_name"]) if item.get("company_name") else None,
        categories=[str(x) for x in item.get("categories", [])],
    )


def parse_pdt_assessment(item: dict[str, Any]) -> PDTAssessment:
    return PDTAssessment(
        pdt_exempt=bool(item.get("pdt_exempt", False)),
        day_trades_in_window=int(item["day_trades_in_window"]),
        max_non_exempt=int(item.get("max_non_exempt", 3)),
        rolling_business_days=int(item.get("rolling_business_days", 5)),
        allow_next_day_trade=bool(item.get("allow_next_day_trade", True)),
        warn_near_limit=bool(item.get("warn_near_limit", False)),
        at_limit=bool(item.get("at_limit", False)),
    )


def parse_gap_candidate(item: dict[str, Any]) -> PremarketGapCandidate:
    return PremarketGapCandidate(
        symbol=str(item["symbol"]).upper(),
        prev_close=float(item["prev_close"]),
        premarket_price=float(item["premarket_price"]),
        gap_percent=float(item["gap_percent"]),
        day_volume=float(item["day_volume"]),
        direction=str(item["direction"]),
        rank_score=float(item["rank_score"]),
    )


def parse_catalyst(item: dict[str, Any]) -> NewsCatalystCandidate:
    return NewsCatalystCandidate(
        article_id=str(item["article_id"]),
        symbol=str(item["symbol"]).upper(),
        title=str(item["title"]),
        catalyst_type=str(item["catalyst_type"]),
        direction=str(item["direction"]),
        catalyst_score=float(item["catalyst_score"]),
        sentiment_score=float(item["sentiment_score"]),
        source=str(item["source"]) if item.get("source") is not None else None,
        sentiment_label=str(item.get("sentiment_label") or "mixed"),
        narrative_score=int(item.get("narrative_score") or 55),
    )


def _norm_axis(value: str) -> str:
    return str(value or "neutral").strip().lower()


def serialize_intraday_setup(
    candidate: IntradaySetupCandidate,
    *,
    snapshot: dict[str, Any] | None = None,
    news_catalyst: dict[str, Any] | None = None,
    regime: str = "neutral",
    sector_signal: str = "neutral",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "symbol": candidate.symbol,
        "direction": candidate.direction,
        "score": candidate.score,
        "triggers": candidate.triggers,
        "last_price": candidate.last_price,
        "vwap": candidate.vwap,
        "ema9": candidate.ema9,
        "timestamp_iso": candidate.timestamp_iso,
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }
    if candidate.company_name:
        payload["company_name"] = candidate.company_name

    snap = dict(snapshot or {})
    if not snap.get("last_trade_price"):
        snap["last_trade_price"] = candidate.last_price
    if snap.get("day_vwap") in (None, 0) and candidate.vwap is not None:
        snap["day_vwap"] = float(candidate.vwap)

    signal_data: dict[str, Any] = {
        "pattern": " ".join(candidate.triggers),
        "volume_vs_avg": candidate.volume_vs_avg,
        "gap_pct": candidate.gap_pct,
        "ema9": candidate.ema9,
        "last_trade_price": candidate.last_price,
    }
    det = ConfluenceDetector()
    cf = det.calculate_confluence(
        symbol=candidate.symbol,
        direction=candidate.direction,
        signal_data=signal_data,
        snapshot=snap,
        news_catalyst=news_catalyst,
        regime=_norm_axis(regime),
        sector_signal=_norm_axis(sector_signal),
    )
    payload.update(confluence_result_to_response_fields(cf))
    return payload


def serialize_intraday_setups_with_confluence(
    candidates: list[IntradaySetupCandidate],
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    """Serialize intraday setups with optional per-symbol snapshot/news maps from request body."""
    regime = _norm_axis(str(payload.get("market_regime") or payload.get("regime") or "neutral"))
    sector = _norm_axis(str(payload.get("sector_signal") or "neutral"))
    snap_map = payload.get("snapshots_by_symbol") or {}
    news_map = payload.get("news_catalysts_by_symbol") or {}
    if not isinstance(snap_map, dict):
        snap_map = {}
    if not isinstance(news_map, dict):
        news_map = {}
    out: list[dict[str, Any]] = []
    for c in candidates:
        sym = c.symbol.upper()
        raw_snap = snap_map.get(sym)
        snap = dict(raw_snap) if isinstance(raw_snap, dict) else {}
        raw_news = news_map.get(sym)
        nc = dict(raw_news) if isinstance(raw_news, dict) else None
        out.append(serialize_intraday_setup(c, snapshot=snap, news_catalyst=nc, regime=regime, sector_signal=sector))
    return out


def serialize_gap_candidate(candidate: PremarketGapCandidate) -> dict[str, Any]:
    return {
        "symbol": candidate.symbol,
        "prev_close": candidate.prev_close,
        "premarket_price": candidate.premarket_price,
        "gap_percent": candidate.gap_percent,
        "day_volume": candidate.day_volume,
        "direction": candidate.direction,
        "rank_score": candidate.rank_score,
    }


def serialize_catalyst(candidate: NewsCatalystCandidate) -> dict[str, Any]:
    return {
        "article_id": candidate.article_id,
        "symbol": candidate.symbol,
        "title": candidate.title,
        "catalyst_type": candidate.catalyst_type,
        "direction": candidate.direction,
        "catalyst_score": candidate.catalyst_score,
        "sentiment_score": candidate.sentiment_score,
        "source": candidate.source,
        "sentiment_label": candidate.sentiment_label,
        "narrative_score": candidate.narrative_score,
    }


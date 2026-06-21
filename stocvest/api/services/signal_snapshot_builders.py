"""Build JSON snapshot blobs for :class:`SignalRecord` from swing composite context (no scoring changes)."""

from __future__ import annotations

from typing import Any

from stocvest.data.signal_snapshots import (
    InternalsSnapshot,
    LayerScoresSnapshot,
    MacroSnapshot,
    NewsEventCapture,
    NewsSnapshot,
    SectorSnapshot,
    TechnicalSnapshot,
    layer_scores_snapshot_from_layer_scores,
)

# Cap captured events per signal: enough for an event study, bounded write size.
_MAX_NEWS_EVENTS = 8


def _news_events_capture(news_events: list[dict[str, Any]] | None) -> list[NewsEventCapture]:
    """Normalize engine ``catalyst_headlines`` rows → persisted capture models (B71 Phase B)."""
    if not isinstance(news_events, list):
        return []
    out: list[NewsEventCapture] = []
    for row in news_events:
        if not isinstance(row, dict):
            continue
        title = str(row.get("text") or row.get("title") or "").strip()
        out.append(
            NewsEventCapture(
                title=(title[:120] or None),
                source=(str(row.get("source") or "").strip() or None),
                published_at=(str(row.get("published_at") or "").strip() or None),
                sentiment_score=_f(row.get("sentiment_score")),
                sentiment=(str(row.get("sentiment") or "").strip() or None),
                catalyst_type=(str(row.get("catalyst_type") or "").strip() or None),
                url=(str(row.get("url") or "").strip() or None),
            )
        )
        if len(out) >= _MAX_NEWS_EVENTS:
            break
    return out


def _f(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None  # NaN check


def _price_vs(ref: float | None, last: float | None) -> str | None:
    if ref is None or last is None or ref <= 0:
        return None
    return "above" if last >= ref else "below"


def _labels_from_confluence(rows: Any) -> list[str]:
    if not isinstance(rows, list):
        return []
    out: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            lab = str(row.get("label") or "").strip()
            if lab:
                out.append(lab)
    return out


def build_swing_composite_snapshot_payload(
    *,
    payload: dict[str, Any],
    response_body: dict[str, Any] | None,
    layer_scores: dict[str, float],
) -> dict[str, str | None]:
    """
    Return optional JSON strings for SignalRecord snapshot columns.

    Populates whatever can be derived from the existing request/response
    (snapshot dict, news_catalyst, regime, confluence lists) without
    changing composite scoring.
    """
    snap_raw = payload.get("symbol_snapshot") or payload.get("snapshot") or {}
    snap = dict(snap_raw) if isinstance(snap_raw, dict) else {}
    last = _f(snap.get("last_trade_price"))
    vwap = _f(snap.get("day_vwap"))
    ema9 = _f(payload.get("ema9"))

    technical = TechnicalSnapshot(
        vwap=vwap,
        ema9=ema9,
        price_vs_vwap=_price_vs(vwap, last),
        price_vs_ema9=_price_vs(ema9, last),
        bars_analyzed=0,
    )

    nc_raw = payload.get("news_catalyst")
    nc = dict(nc_raw) if isinstance(nc_raw, dict) else {}
    headline = str(nc.get("headline") or "").strip() or None
    news = NewsSnapshot(
        article_count=1 if headline else 0,
        catalyst_headline=headline,
        sentiment_score=None,
        weighted_sentiment=None,
        catalyst_type=None,
        top_sources=[],
    )

    regime = str(payload.get("regime") or "sideways").strip()
    macro = MacroSnapshot(market_regime=regime)

    sector_sig = str(payload.get("sector_signal") or "neutral").strip()
    sector = SectorSnapshot(sector_leadership=sector_sig)

    internals = InternalsSnapshot()

    rb = response_body if isinstance(response_body, dict) else {}
    confirming = _labels_from_confluence(rb.get("confirming_signals"))
    conflicting = _labels_from_confluence(rb.get("conflicting_signals"))
    layer_snap = layer_scores_snapshot_from_layer_scores(
        layer_scores, confirming=confirming, conflicting=conflicting
    )

    out: dict[str, str | None] = {
        "technical_snapshot_json": technical.model_dump_json(),
        "news_snapshot_json": news.model_dump_json(),
        "macro_snapshot_json": macro.model_dump_json(),
        "sector_snapshot_json": sector.model_dump_json(),
        "internals_snapshot_json": internals.model_dump_json(),
        "layer_scores_json": layer_snap.model_dump_json(),
    }
    return out


def build_real_composite_snapshot_payload(
    *,
    technical: object,
    news: object,
    macro: object,
    sector: object,
    internals: object,
    layer_scores: dict[str, float],
    confirming_labels: list[str],
    conflicting_labels: list[str],
    news_events: list[dict[str, Any]] | None = None,
) -> dict[str, str | None]:
    """Populate :class:`SignalRecord` JSON blobs from server-side real-composite layer outputs.

    ``news_events`` (optional) is the engine's ``catalyst_headlines`` list — top
    article-level events with ``published_at`` + per-ticker ``sentiment_score`` —
    captured into ``NewsSnapshot.top_events`` for the B71 event study. Omitted →
    empty list (pre-B71 behavior).
    """
    from stocvest.signals.internals_analyzer import InternalsLayerResult
    from stocvest.signals.macro_analyzer import MacroLayerResult
    from stocvest.signals.news_analyzer import NewsLayerResult
    from stocvest.signals.sector_analyzer import SectorLayerResult
    from stocvest.signals.swing_technical_analyzer import SwingTechnicalLayerResult
    from stocvest.signals.technical_analyzer import TechnicalLayerResult

    t = technical if isinstance(technical, TechnicalLayerResult) else None
    st = technical if isinstance(technical, SwingTechnicalLayerResult) else None
    n = news if isinstance(news, NewsLayerResult) else None
    m = macro if isinstance(macro, MacroLayerResult) else None
    s = sector if isinstance(sector, SectorLayerResult) else None
    i = internals if isinstance(internals, InternalsLayerResult) else None

    if t:
        tech_snap = TechnicalSnapshot(
            rsi=t.rsi,
            vwap=t.vwap_from_bars,
            ema9=t.ema9,
            ema20=t.ema20,
            price_vs_vwap=t.price_vs_vwap,
            price_vs_ema9=None,
            price_vs_ema20=None,
            orb_signal=t.orb_signal,
            orb_high=t.orb_high,
            orb_low=t.orb_low,
            volume_ratio=t.volume_vs_adv,
            volume_vs_adv=t.volume_vs_adv,
            atr=t.atr,
            prev_day_high=t.prev_day_high,
            prev_day_low=t.prev_day_low,
            bars_analyzed=t.bars_analyzed,
        )
    elif st:
        orb_sig = "golden_cross" if st.golden_cross else None
        if st.sma50 is not None and st.sma200 is not None and st.sma50 < st.sma200:
            orb_sig = "death_cross"
        tech_snap = TechnicalSnapshot(
            rsi=st.daily_rsi,
            vwap=None,
            ema9=st.sma50,
            ema20=st.sma200,
            price_vs_vwap=None,
            price_vs_ema9=None,
            price_vs_ema20=None,
            orb_signal=orb_sig,
            orb_high=None,
            orb_low=None,
            volume_ratio=None,
            volume_vs_adv=None,
            atr=None,
            prev_day_high=None,
            prev_day_low=None,
            bars_analyzed=st.bars_analyzed,
        )
    else:
        tech_snap = TechnicalSnapshot(
            rsi=None,
            vwap=None,
            ema9=None,
            ema20=None,
            price_vs_vwap=None,
            price_vs_ema9=None,
            price_vs_ema20=None,
            orb_signal=None,
            orb_high=None,
            orb_low=None,
            volume_ratio=None,
            volume_vs_adv=None,
            atr=None,
            prev_day_high=None,
            prev_day_low=None,
            bars_analyzed=0,
        )

    news_snap = NewsSnapshot(
        article_count=n.article_count if n else 0,
        catalyst_headline=n.catalyst_headline if n else None,
        sentiment_score=n.weighted_sentiment if n else None,
        weighted_sentiment=n.weighted_sentiment if n else None,
        catalyst_type=n.catalyst_type if n else None,
        top_sources=[],
        top_events=_news_events_capture(news_events),
    )

    macro_snap = MacroSnapshot(
        spy_day_pct=m.spy_day_pct if m else None,
        qqq_day_pct=m.qqq_day_pct if m else None,
        vix_price=m.vix_price if m else None,
        vix_day_change_pct=None,
        vix_trend=m.vix_trend if m else None,
        market_regime=m.market_regime if m else None,
        economic_event_today=m.event_today if m else False,
        economic_event_name=m.event_name if m else None,
    )

    sector_snap = SectorSnapshot(
        sector_etf=s.sector_etf if s else None,
        sector_day_pct=s.sector_day_pct if s else None,
        sector_vs_spy_pct=s.relative_strength if s else None,
        sector_leadership=s.sector_signal if s else None,
    )

    internals_snap = InternalsSnapshot(
        vix_price=i.vix_price if i else None,
        breadth_score=None,
        participation=i.participation if i else None,
    )

    layer_snap = layer_scores_snapshot_from_layer_scores(
        layer_scores, confirming=confirming_labels, conflicting=conflicting_labels
    )

    return {
        "technical_snapshot_json": tech_snap.model_dump_json(),
        "news_snapshot_json": news_snap.model_dump_json(),
        "macro_snapshot_json": macro_snap.model_dump_json(),
        "sector_snapshot_json": sector_snap.model_dump_json(),
        "internals_snapshot_json": internals_snap.model_dump_json(),
        "layer_scores_json": layer_snap.model_dump_json(),
    }

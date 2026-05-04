"""Build JSON snapshot blobs for :class:`SignalRecord` from swing composite context (no scoring changes)."""

from __future__ import annotations

from typing import Any

from stocvest.data.signal_snapshots import (
    InternalsSnapshot,
    LayerScoresSnapshot,
    MacroSnapshot,
    NewsSnapshot,
    SectorSnapshot,
    TechnicalSnapshot,
    layer_scores_snapshot_from_layer_scores,
)


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

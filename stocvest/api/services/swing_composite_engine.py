"""Swing-mode real composite: same six layers, daily bars + extended news/macro windows."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.api.services.portfolio_auto_log import schedule_model_portfolio_log_from_composite
from stocvest.api.services.real_composite_engine import (
    _regime_for_engine,
    _safe_result,
    _score_to_layer_signal,
)
from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.api.services.signal_snapshot_builders import build_real_composite_snapshot_payload
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.models import Bar, SignalRecord, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields, normalize_direction
from stocvest.signals.composite_score import CompositeScoreEngine, CompositeVerdict, LayerSignal
from stocvest.signals.geo_analyzer import GeoAnalyzer
from stocvest.signals.internals_analyzer import InternalsAnalyzer
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.signals.news_analyzer import NewsAnalyzer
from stocvest.signals.sector_analyzer import SectorAnalyzer
from stocvest.signals.sector_mapper import SectorMapper
from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_COMPOSITE_INSUFFICIENT_MESSAGE = (
    "Insufficient market data to generate a reliable signal. "
    "Daily and macro context is required for at least 3 of 6 layers."
)


def _weekly_pct_from_daily_bars(bars: list[Bar]) -> float | None:
    """~5 session return using last six daily closes (oldest vs newest)."""
    if len(bars) < 6:
        return None
    ordered = sorted(bars, key=lambda b: b.timestamp)
    c = [b.close for b in ordered]
    old, new = c[-6], c[-1]
    if old <= 0:
        return None
    return (new / old - 1.0) * 100.0


async def build_swing_composite_response(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None,
    params: SignalParameters,
) -> dict[str, Any]:
    sym = symbol.strip().upper()
    settings = get_settings()
    sector_cache = DynamoSectorCache(settings.dynamodb_sector_cache_table)
    news_since = datetime.now(timezone.utc) - timedelta(hours=float(params.swing_news_lookback_hours))
    econ_end = date.today() + timedelta(days=max(0, int(params.swing_macro_events_days) - 1))

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        daily_r, sym_r, news_r, spy_r, qqq_r, vix_r, econ_r = await asyncio.gather(
            client.get_bars(sym, Timeframe.DAY_1, limit=params.swing_technical.daily_bars_lookback),
            client.get_snapshot(sym),
            client.get_market_news(tickers=[sym], limit=50, published_utc_gte=news_since),
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
            get_vix_snapshot_with_fallback(client),
            client.get_economic_calendar_range(date.today(), econ_end),
            return_exceptions=True,
        )

        daily_bars: list[Bar] = _safe_result(daily_r, [])
        sym_snap: Snapshot | None = _safe_result(sym_r, None)
        news_rows: list[dict[str, Any]] = _safe_result(news_r, [])
        spy_snap: Snapshot | None = _safe_result(spy_r, None)
        qqq_snap: Snapshot | None = _safe_result(qqq_r, None)
        vix_snap: Snapshot | None = _safe_result(vix_r, None)
        econ = _safe_result(econ_r, [])

        sector_snap: Snapshot | None = None
        sector_display: str | None = None
        spy_week_bars: list[Bar] = []
        sector_week_bars: list[Bar] = []
        if sym_snap is not None:
            try:
                etf, sector_display = await SectorMapper.get_sector_etf(
                    sym,
                    client,
                    sector_cache if sector_cache.enabled else None,
                    params.sector,
                )
                sector_snap_r, spy_bars_r = await asyncio.gather(
                    client.get_snapshot(etf),
                    client.get_bars("SPY", Timeframe.DAY_1, limit=10),
                    return_exceptions=True,
                )
                sector_snap = _safe_result(sector_snap_r, None)
                spy_week_bars = _safe_result(spy_bars_r, [])
                if sector_snap is not None:
                    sb = await client.get_bars(etf, Timeframe.DAY_1, limit=10)
                    sector_week_bars = _safe_result(sb, [])
            except (PolygonError, Exception) as exc:
                _LOG.warning("swing sector chain failed for %s: %s", sym, exc)

    snap_for_tech = sym_snap if sym_snap is not None else Snapshot(symbol=sym)
    tech = SwingTechnicalAnalyzer().analyze(sym, daily_bars, snap_for_tech, params.swing_technical)
    news = NewsAnalyzer().analyze(sym, news_rows, params.news, lookback_hours=params.swing_news_lookback_hours)
    macro = MacroAnalyzer().analyze(
        spy_snap,
        qqq_snap,
        vix_snap,
        econ,
        params.macro,
        events_lookback_days=params.swing_macro_events_days,
    )

    w_sec = _weekly_pct_from_daily_bars(sector_week_bars) if params.swing_sector_use_weekly else None
    w_spy = _weekly_pct_from_daily_bars(spy_week_bars) if params.swing_sector_use_weekly else None
    sector = SectorAnalyzer().analyze(
        sym,
        sector_snap,
        spy_snap,
        params.sector,
        sector_display_name=sector_display,
        use_weekly=params.swing_sector_use_weekly,
        weekly_sector_pct=w_sec,
        weekly_spy_pct=w_spy,
    )
    geo = GeoAnalyzer().analyze(news_rows, lookback_hours=params.swing_geo_lookback_hours)
    internals = InternalsAnalyzer().analyze(vix_snap, spy_snap, qqq_snap, params.macro)

    layer_results = [tech, news, macro, sector, geo, internals]
    layer_ids = ["technical", "news", "macro", "sector", "geopolitical", "internals"]
    available = [r for r in layer_results if getattr(r, "status", "") == "available"]
    min_layers = int(params.composite.min_available_layers)
    if len(available) < min_layers:
        return {
            "symbol": sym,
            "status": "insufficient_data",
            "available_layers": len(available),
            "required_layers": min_layers,
            "message": _COMPOSITE_INSUFFICIENT_MESSAGE,
            "market_status": fetch_composite_market_status_payload_sync(),
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "mode": "swing",
        }

    signals: list[LayerSignal] = []
    for lid, res in zip(layer_ids, layer_results):
        sig = _score_to_layer_signal(lid, getattr(res, "score", None), getattr(res, "status", ""))
        if sig is not None:
            signals.append(sig)

    base_weights = {
        "technical": params.composite.technical_weight,
        "news": params.composite.news_weight,
        "macro": params.composite.macro_weight,
        "sector": params.composite.sector_weight,
        "geopolitical": params.composite.geopolitical_weight,
        "internals": params.composite.internals_weight,
    }
    regime = _regime_for_engine(macro.market_regime)
    engine = CompositeScoreEngine(
        base_weights=base_weights,
        bullish_threshold=float(params.composite.bullish_threshold),
        bearish_threshold=float(params.composite.bearish_threshold),
    )
    composite = engine.compute(signals, regime=regime)

    contributions: list[dict[str, Any]] = []
    for c in composite.contributions:
        reasoning = ""
        for lid, res in zip(layer_ids, layer_results):
            if lid == c.layer:
                reasoning = str(getattr(res, "reasoning", "") or "")
                break
        contributions.append(
            {
                "layer": c.layer,
                "raw_score": c.raw_score,
                "reasoning": reasoning or f"{c.layer} contributes {c.raw_score:+.2f} with weight {c.base_weight:.2f}.",
                "signal_strength": c.confidence,
                "base_weight": c.base_weight,
                "regime_multiplier": c.regime_multiplier,
                "effective_weight": c.effective_weight,
                "weighted_value": c.weighted_value,
            }
        )

    layers_out: list[dict[str, Any]] = []
    for lid, res in zip(layer_ids, layer_results):
        layers_out.append(
            {
                "layer": lid,
                "status": getattr(res, "status", "unavailable"),
                "score": getattr(res, "score", None),
                "verdict": getattr(res, "verdict", "neutral"),
                "reasoning": getattr(res, "reasoning", ""),
                "chips": list(getattr(res, "chips", []) or []),
            }
        )

    snap_dict = sym_snap.model_dump(mode="json") if sym_snap else {}
    direction_out = ""
    if composite.verdict == CompositeVerdict.BULLISH:
        direction_out = "long"
    elif composite.verdict == CompositeVerdict.BEARISH:
        direction_out = "short"

    expires_at = datetime.now(timezone.utc) + timedelta(days=5)

    response_body: dict[str, Any] = {
        "symbol": sym,
        "score": composite.score,
        "signal_strength": composite.confidence,
        "signal_summary": composite.verdict.value,
        "contributions": contributions,
        "layers": layers_out,
        "regime": regime,
        "parameter_version": params.version,
        "disclaimer": API_SIGNAL_DISCLAIMER,
        "mode": "swing",
        "signal_valid_days": 5,
        "signal_expires": expires_at.replace(microsecond=0).isoformat(),
    }

    if direction_out:
        nc: dict[str, Any] | None = None
        if news.catalyst_headline:
            nc = {
                "headline": str(news.catalyst_headline),
                "sentiment": "positive"
                if news.verdict == "bullish"
                else ("negative" if news.verdict == "bearish" else "neutral"),
            }
        last_px = float(sym_snap.last_trade_price) if sym_snap and sym_snap.last_trade_price else 0.0
        pattern = str(getattr(tech, "confluence_pattern", None) or "swing_composite")
        sig_data = {
            "pattern": pattern,
            "volume_vs_avg": 1.0,
            "gap_pct": 0.0,
            "ema9": getattr(tech, "sma50", None),
            "last_trade_price": last_px,
        }
        cf = ConfluenceDetector().calculate_confluence(
            symbol=sym or "PORTFOLIO",
            direction=direction_out,
            signal_data=sig_data,
            snapshot=snap_dict,
            news_catalyst=nc,
            regime=normalize_direction(macro.market_regime),
            sector_signal=normalize_direction(sector.sector_signal),
        )
        response_body.update(confluence_result_to_response_fields(cf))

        cf_subset = {
            "confirming_signals": response_body.get("confirming_signals"),
            "conflicting_signals": response_body.get("conflicting_signals"),
            "n_confirming": response_body.get("n_confirming"),
            "n_conflicting": response_body.get("n_conflicting"),
        }
        payload_stub = {
            "regime": regime,
            "sector_signal": sector.sector_signal,
            "news_catalyst": nc,
        }
        response_body.update(
            build_swing_composite_evidence_fields(
                composite=composite,
                regime=regime,
                payload=payload_stub,
                confluence=cf_subset,
                snapshot=snap_dict,
            )
        )

        price_at = last_px
        if price_at:
            try:
                layer_scores = {s.layer: float(s.score) for s in signals}
                strength = int(round(max(0.0, min(1.0, composite.confidence)) * 100))
                confirming_labs = [str(x.get("label") or "") for x in (cf.confirming_signals or []) if isinstance(x, dict)]
                conflicting_labs = [str(x.get("label") or "") for x in (cf.conflicting_signals or []) if isinstance(x, dict)]
                blobs = build_real_composite_snapshot_payload(
                    technical=tech,
                    news=news,
                    macro=macro,
                    sector=sector,
                    internals=internals,
                    layer_scores=layer_scores,
                    confirming_labels=confirming_labs,
                    conflicting_labels=conflicting_labs,
                )
                record = SignalRecord(
                    signal_id=str(uuid4()),
                    symbol=sym,
                    direction=str(composite.verdict.value),
                    signal_strength=strength,
                    pattern=pattern,
                    layer_scores=layer_scores,
                    price_at_signal=price_at,
                    generated_at=datetime.now(timezone.utc),
                    user_id=user_id,
                    parameter_version=params.version,
                    technical_snapshot_json=blobs.get("technical_snapshot_json"),
                    news_snapshot_json=blobs.get("news_snapshot_json"),
                    macro_snapshot_json=blobs.get("macro_snapshot_json"),
                    sector_snapshot_json=blobs.get("sector_snapshot_json"),
                    internals_snapshot_json=blobs.get("internals_snapshot_json"),
                    layer_scores_json=blobs.get("layer_scores_json"),
                )
                get_signal_recorder().record_signal(record)
                if user_id and user_email and direction_out:
                    from stocvest.api.services.alert_tasks import run_alert_background
                    from stocvest.services.alert_trigger import get_alert_trigger

                    def _fire_alert() -> None:
                        get_alert_trigger().trigger_signal_alert(
                            user_id=user_id or "",
                            user_email=user_email or "",
                            symbol=sym,
                            direction=direction_out,
                            signal_strength=strength,
                            pattern=pattern,
                            is_confluence=bool(response_body.get("is_confluence_alert")),
                            confluence_score=int(response_body.get("confluence_score") or 0),
                        )

                    run_alert_background(_fire_alert)

                score_0_100 = int(round((float(composite.score) + 1.0) * 50.0))
                score_0_100 = max(0, min(100, score_0_100))
                schedule_model_portfolio_log_from_composite(
                    symbol=sym,
                    composite_verdict=composite.verdict,
                    composite_score=score_0_100,
                    entry_price=price_at,
                    layer_results=layer_results,
                    macro_regime=str(macro.market_regime or "neutral"),
                    confluence_fired=bool(response_body.get("is_confluence_alert")),
                    confluence_score=int(response_body.get("confluence_score") or 0),
                    vix_at_entry=float(internals.vix_price) if internals.vix_price is not None else None,
                    spy_day_pct=float(macro.spy_day_pct) if macro.spy_day_pct is not None else None,
                    sector_etf=(str(sector.sector_etf).strip().upper() if getattr(sector, "sector_etf", None) else None),
                    sector_day_pct=float(sector.sector_day_pct) if sector.sector_day_pct is not None else None,
                    parameter_version=str(params.version or "1.0.0"),
                )
            except Exception as exc:
                _LOG.warning("swing record_signal skipped: %s", exc)

    return response_body


def swing_composite_body_sync(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None = None,
    params: SignalParameters | None = None,
) -> dict[str, Any]:
    p = params or ParameterStore.get_parameters_sync()
    return asyncio.run(
        build_swing_composite_response(symbol=symbol, user_id=user_id, user_email=user_email, params=p)
    )

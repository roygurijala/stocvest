"""Server-side multi-layer composite (symbol in → scores out)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo
from uuid import uuid4

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.services.composite_sector_wire import sector_layer_api_extras
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.api.services.signal_snapshot_builders import build_real_composite_snapshot_payload
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.services.signal_validation_eligibility import (
    derive_decision_state,
    entry_rationale_from_gates,
    evaluate_day_ledger_entry,
    gate_blob_json,
)
from stocvest.api.services.validation_timing import (
    MIN_SESSION_VOLUME_SHARES_DAY_LEDGER,
    build_regime_window_key,
    is_day_ledger_entry_session_et,
)
from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.benzinga_client import BenzingaClient, BenzingaMultiResult
from stocvest.data.models import Bar, SignalRecord, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields, normalize_direction
from stocvest.signals.composite_score import (
    CompositeSignal,
    CompositeVerdict,
    LayerSignal,
    build_composite_score_engine_from_params,
)
from stocvest.signals.geo_analyzer import GeoAnalyzer
from stocvest.signals.internals_analyzer import InternalsAnalyzer
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.signals.macro_context import get_macro_context
from stocvest.signals.news_analyzer import NewsAnalyzer
from stocvest.signals.alignment_score import AlignmentResult, adjust_composite_with_alignment, alignment_to_response_dict
from stocvest.signals.sector_analyzer import SectorAnalyzer
from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.signals.sector_momentum import (
    SectorMomentumScore,
    compute_day_sector_score,
    session_details_from_returns,
)
from stocvest.workers.sector_daily_cache import get_all_cached_sector_data, get_cached_sector_returns
from stocvest.signals.technical_analyzer import TechnicalAnalyzer
from stocvest.signals.vwap_state import vwap_session_flags_et
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_COMPOSITE_INSUFFICIENT_MESSAGE = (
    "Insufficient market data to generate a reliable signal. "
    "Real-time data is required for at least 3 of 6 layers."
)


def _next_rth_close_utc_iso() -> str:
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    d = now.date()
    for _ in range(14):
        if d.weekday() < 5:
            close = datetime.combine(d, time(16, 0), tzinfo=et)
            if close >= now:
                return close.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        d += timedelta(days=1)
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_result(result: object, default: Any) -> Any:
    if isinstance(result, Exception):
        return default
    return result


def _merge_benzinga_first_news_rows(
    polygon_rows: list[dict[str, Any]],
    bz_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    titles = {
        str(r.get("title") or "").strip().lower()
        for r in bz_rows
        if isinstance(r, dict) and str(r.get("title") or "").strip()
    }
    out = list(bz_rows)
    for r in polygon_rows:
        if not isinstance(r, dict):
            continue
        t = str(r.get("title") or "").strip().lower()
        if not t:
            continue
        if t in titles:
            continue
        out.append(r)
        titles.add(t)
    return out


def _benzinga_articles_to_rows(items: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in items:
        title = str(getattr(a, "title", "") or "").strip()
        if not title:
            continue
        out.append(
            {
                "id": str(getattr(a, "article_id", "") or ""),
                "title": title,
                "description": str(getattr(a, "body", "") or ""),
                "published_utc": getattr(a, "published_at", datetime.now(timezone.utc)).isoformat(),
                "tickers": list(getattr(a, "tickers", []) or []),
                "source": str(getattr(a, "source", "benzinga") or "benzinga"),
                "article_url": getattr(a, "url", None),
                "publisher": {"name": "Benzinga"},
                "insights": [],
            }
        )
    return out


def _score_to_layer_signal(layer: str, score: int | None, status: str) -> LayerSignal | None:
    if status != "available" or score is None:
        return None
    raw = (float(score) - 50.0) / 50.0
    raw = max(-1.0, min(1.0, raw))
    return LayerSignal(layer=layer, score=raw, confidence=1.0)


def _regime_for_engine(market_regime: str) -> str:
    m = (market_regime or "").strip().lower()
    if m in ("risk_on", "bullish", "bull"):
        return "bull"
    if m in ("risk_off", "bearish", "bear", "avoid"):
        return "bear"
    return "sideways"


def _market_open_now() -> bool:
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return False
    hhmm = now.hour * 100 + now.minute
    return 930 <= hhmm <= 1600


def _build_catalyst_headlines(news_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in news_rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        sent = 0.0
        insights = row.get("insights")
        if isinstance(insights, list) and insights:
            first = insights[0]
            if isinstance(first, dict):
                s = str(first.get("sentiment") or "").strip().lower()
                if s in {"positive", "bullish"}:
                    sent = 1.0
                elif s in {"negative", "bearish"}:
                    sent = -1.0
        if abs(sent) < 0.3:
            continue
        out.append(
            {
                "text": title[:80],
                "source": str(row.get("source") or "polygon").strip().lower() or "polygon",
                "published_at": str(row.get("published_utc") or ""),
                "sentiment_score": sent,
                "sentiment": "positive" if sent > 0 else "negative",
                "catalyst_type": "macro" if "fed" in title.lower() else "news",
                "url": row.get("article_url"),
            }
        )
    out.sort(key=lambda x: abs(float(x.get("sentiment_score") or 0.0)), reverse=True)
    return out[:3]


@dataclass(frozen=True)
class RealCompositeEnginePhase:
    """Polygon + layer analyzers + :class:`CompositeScoreEngine` output (no HTTP payload, no side effects)."""

    sym: str
    sym_snap: Snapshot | None
    bars: list[Bar]
    news_rows: list[dict[str, Any]]
    layer_results: list[Any]
    layer_ids: list[str]
    signals: list[LayerSignal]
    regime: str
    composite: CompositeSignal
    alignment: AlignmentResult | None = None
    sector_momentum: SectorMomentumScore | None = None
    sector_resolution_state: SectorResolutionState | None = None
    sic_mapping_tier: SicMappingTier | None = None


async def run_real_composite_engine_phase(
    *, symbol: str, params: SignalParameters
) -> dict[str, Any] | RealCompositeEnginePhase:
    """
    Shared scoring path for real composite: data fetch → six layers → engine.compute.

    Returns either the standard ``insufficient_data`` response dict or a
    :class:`RealCompositeEnginePhase` for callers that build a full HTTP body or
    a narrow verdict read.
    """
    sym = symbol.strip().upper()
    settings = get_settings()
    sector_cache = DynamoSectorCache(settings.dynamodb_sector_cache_table)

    news_since = datetime.now(timezone.utc) - timedelta(hours=float(params.news.lookback_hours))
    benzinga = BenzingaClient()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        bars_r, sym_r, news_r, spy_r, qqq_r, vix_r, econ_r, bz_r = await asyncio.gather(
            client.get_bars(sym, Timeframe.MIN_1, limit=60),
            client.get_snapshot(sym),
            client.get_market_news(tickers=[sym], limit=20, published_utc_gte=news_since),
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
            get_vix_snapshot_with_fallback(client),
            client.get_economic_calendar_for_day(date.today()),
            benzinga.get_multi(sym, mode="day"),
            return_exceptions=True,
        )

        bars: list[Bar] = _safe_result(bars_r, [])
        sym_snap: Snapshot | None = _safe_result(sym_r, None)
        news_polygon: list[dict[str, Any]] = _safe_result(news_r, [])
        bz_data: BenzingaMultiResult = _safe_result(bz_r, BenzingaMultiResult())
        news_rows = _merge_benzinga_first_news_rows(news_polygon, _benzinga_articles_to_rows(bz_data.news))
        spy_snap: Snapshot | None = _safe_result(spy_r, None)
        qqq_snap: Snapshot | None = _safe_result(qqq_r, None)
        vix_snap: Snapshot | None = _safe_result(vix_r, None)
        econ = _safe_result(econ_r, [])

        sector_snap: Snapshot | None = None
        sector_display: str | None = None
        sic_bucket_for_geo: str | None = None
        sector_resolution_state: SectorResolutionState | None = None
        sic_mapping_tier: SicMappingTier | None = None
        sector_etf_sym: str = ""
        if sym_snap is not None:
            try:
                etf, sector_display, sic_bucket_for_geo, sector_resolution_state, sic_mapping_tier = (
                    await SectorMapper.get_sector_etf(
                        sym,
                        client,
                        sector_cache if sector_cache.enabled else None,
                        params.sector,
                    )
                )
                sector_etf_sym = (etf or "").strip().upper()
                if sector_etf_sym and sector_resolution_state != SectorResolutionState.PENDING_REFRESH:
                    sector_snap = await client.get_snapshot(etf)
            except (PolygonError, Exception) as exc:
                _LOG.warning("sector snapshot chain failed for %s: %s", sym, exc)

    all_sector_daily = get_all_cached_sector_data()
    sector_momentum: SectorMomentumScore | None = None
    if sector_resolution_state not in (None, SectorResolutionState.PENDING_REFRESH):
        eff = (sector_etf_sym or "SPY").strip().upper()
        if eff:
            sector_momentum = compute_day_sector_score(
                eff,
                sic_bucket_for_geo or "default",
                get_cached_sector_returns(eff) or [],
                all_sector_daily,
            )

    snap_for_tech = sym_snap if sym_snap is not None else Snapshot(symbol=sym)
    adv = float(sym_snap.prev_day_volume) if sym_snap and sym_snap.prev_day_volume else None

    tech = TechnicalAnalyzer().analyze(sym, bars, snap_for_tech, params.technical, adv=adv)
    news = NewsAnalyzer().analyze(
        sym,
        news_rows,
        params.news,
        lookback_hours=params.news.lookback_hours,
        mode="day",
        benzinga_data=bz_data,
    )
    macro_ctx = await get_macro_context(polygon_econ_events=econ)
    macro = MacroAnalyzer().analyze(
        spy_snap, qqq_snap, vix_snap, econ, params.macro, events_lookback_days=1, macro_context=macro_ctx
    )
    sector = SectorAnalyzer().analyze(
        sym,
        sector_snap,
        spy_snap,
        params.sector,
        sector_display_name=sector_display,
        resolution_state=sector_resolution_state,
        sector_momentum=sector_momentum,
        mode="day",
    )
    geo = GeoAnalyzer().analyze(
        news_rows, lookback_hours=params.news.lookback_hours, sector_bucket=sic_bucket_for_geo
    )
    if geo.geo_active_events and geo.geo_impact_sector_key and geo.geo_exposure_summary:
        from stocvest.signals.geo_exposure_llm import try_claude_geo_exposure_line

        llm_line = await try_claude_geo_exposure_line(
            events=geo.geo_active_events,
            impact_sector_key=geo.geo_impact_sector_key,
            weighted_score=float(geo.geo_stock_exposure_score or 0.0),
            template_fallback=geo.geo_exposure_summary,
        )
        if llm_line:
            geo.geo_exposure_summary = llm_line
    internals = InternalsAnalyzer().analyze(vix_snap, spy_snap, qqq_snap, params.macro)

    layer_results = [tech, news, macro, sector, geo, internals]
    layer_ids = ["technical", "news", "macro", "sector", "geopolitical", "internals"]
    available = [r for r in layer_results if getattr(r, "status", "") == "available"]
    min_layers = int(params.composite.min_available_layers)
    if len(available) < min_layers:
        return {
            "symbol": sym,
            "status": "insufficient_data",
            "decision_state": "blocked",
            "available_layers": len(available),
            "required_layers": min_layers,
            "message": _COMPOSITE_INSUFFICIENT_MESSAGE,
            "market_status": fetch_composite_market_status_payload_sync(),
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "mode": "day",
        }

    signals: list[LayerSignal] = []
    for lid, res in zip(layer_ids, layer_results):
        sig = _score_to_layer_signal(lid, getattr(res, "score", None), getattr(res, "status", ""))
        if sig is not None:
            signals.append(sig)

    regime = _regime_for_engine(macro.market_regime)
    engine = build_composite_score_engine_from_params(params)
    composite_raw = engine.compute(signals, regime=regime)
    sector_persist = float(sector_momentum.persistence) if sector_momentum else 0.5
    composite, alignment = adjust_composite_with_alignment(
        composite_raw,
        macro_verdict=str(macro.verdict or "neutral"),
        macro_regime=str(macro.market_regime or "neutral"),
        sector_verdict=str(sector.verdict or "neutral"),
        sector_persistence=sector_persist,
        technical_verdict=str(tech.verdict or "neutral"),
        bullish_threshold=float(params.composite.bullish_threshold),
        bearish_threshold=float(params.composite.bearish_threshold),
    )
    _LOG.info(
        "alignment_computed symbol=%s level=%s modifier=%.1f raw=%.4f final=%.4f macro=%s sector=%s tech=%s",
        sym,
        alignment.level.value,
        alignment.score_modifier,
        composite_raw.score,
        composite.score,
        alignment.macro_direction,
        alignment.sector_direction,
        alignment.technical_direction,
    )

    return RealCompositeEnginePhase(
        sym=sym,
        sym_snap=sym_snap,
        bars=bars,
        news_rows=news_rows,
        layer_results=layer_results,
        layer_ids=layer_ids,
        signals=signals,
        regime=regime,
        composite=composite,
        alignment=alignment,
        sector_momentum=sector_momentum,
        sector_resolution_state=sector_resolution_state,
        sic_mapping_tier=sic_mapping_tier,
    )


async def build_real_composite_response(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None,
    params: SignalParameters,
) -> dict[str, Any]:
    sym = symbol.strip().upper()
    phase = await run_real_composite_engine_phase(symbol=sym, params=params)
    if isinstance(phase, dict):
        return phase

    sym = phase.sym
    sym_snap = phase.sym_snap
    bars = phase.bars
    news_rows = phase.news_rows
    layer_results = phase.layer_results
    layer_ids = phase.layer_ids
    signals = phase.signals
    regime = phase.regime
    composite = phase.composite
    alignment = getattr(phase, "alignment", None)
    sector_momentum = getattr(phase, "sector_momentum", None)
    sector_resolution_state = getattr(phase, "sector_resolution_state", None)
    sic_mapping_tier = getattr(phase, "sic_mapping_tier", None)
    tech, news, macro, sector, geo, internals = layer_results

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
        row: dict[str, Any] = {
            "layer": lid,
            "status": getattr(res, "status", "unavailable"),
            "score": getattr(res, "score", None),
            "verdict": getattr(res, "verdict", "neutral"),
            "reasoning": getattr(res, "reasoning", ""),
            "chips": list(getattr(res, "chips", []) or []),
        }
        if lid == "news":
            row["wim_summary"] = getattr(res, "wim_summary", None)
            row["data_state"] = getattr(res, "data_state", "fresh")
            row["article_count"] = int(getattr(res, "article_count", 0) or 0)
            row["latest_rating"] = getattr(res, "latest_rating", None)
            row["latest_guidance"] = getattr(res, "latest_guidance", None)
            row["earnings_result"] = getattr(res, "earnings_result", None)
        if lid == "geopolitical":
            row["geo_active_events"] = list(getattr(res, "geo_active_events", []) or [])
            row["geo_impact_sector_key"] = getattr(res, "geo_impact_sector_key", "") or ""
            row["geo_stock_exposure_score"] = getattr(res, "geo_stock_exposure_score", None)
            row["geo_exposure_summary"] = getattr(res, "geo_exposure_summary", None)
            row["geo_event_details"] = list(getattr(res, "geo_event_details", []) or [])
            band = str(getattr(res, "geo_exposure_band", "") or "").strip()
            row["geo_exposure_band"] = band if band else None
            row["geo_baseline_score"] = int(getattr(res, "geo_baseline_score", 0) or 0)
            row["geo_baseline_summary"] = str(getattr(res, "geo_baseline_summary", "") or "")
            row["geo_has_live_events"] = bool(getattr(res, "geo_has_live_events", False))
            row["geo_primary_theme"] = getattr(res, "geo_primary_theme", None)
        if lid == "technical":
            row["vwap_state"] = getattr(res, "vwap_state", None)
            row["vwap_state_tooltip"] = getattr(res, "vwap_state_tooltip", None)
        if lid == "macro":
            row["macro_warnings"] = list(getattr(res, "macro_warnings", None) or [])
            row["macro_risk_level"] = getattr(res, "macro_risk_level", None)
            row["upcoming_events"] = list(getattr(res, "upcoming_events", None) or [])
            row["yield_curve"] = getattr(res, "yield_curve", None)
        if lid == "sector":
            ds = None
            if sector_momentum:
                ds = session_details_from_returns(
                    get_cached_sector_returns(sector_momentum.etf) or []
                )
            row.update(
                sector_layer_api_extras(
                    momentum=sector_momentum,
                    resolution_state=sector_resolution_state,
                    daily_sessions=ds,
                    sic_mapping_tier=sic_mapping_tier,
                )
            )
        layers_out.append(row)

    snap_dict = sym_snap.model_dump(mode="json") if sym_snap else {}
    direction_out = ""
    if composite.verdict == CompositeVerdict.BULLISH:
        direction_out = "long"
    elif composite.verdict == CompositeVerdict.BEARISH:
        direction_out = "short"

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
        "mode": "day",
        "signal_valid_until": _next_rth_close_utc_iso(),
        "alignment_ratio": composite.alignment_ratio,
        "conflicted_layers": list(composite.conflicted_layers or []),
    }
    if alignment is not None:
        response_body["alignment"] = alignment_to_response_dict(alignment)

    nc: dict[str, Any] | None = None
    if news.catalyst_headline:
        nc = {
            "headline": str(news.catalyst_headline),
            "sentiment": "positive"
            if news.verdict == "bullish"
            else ("negative" if news.verdict == "bearish" else "neutral"),
        }
    last_px = float(sym_snap.last_trade_price) if sym_snap and sym_snap.last_trade_price else 0.0

    cf: Any = None
    cf_subset: dict[str, Any] | None = None
    if direction_out:
        sig_data = {
            "pattern": str(tech.orb_signal or "swing_composite"),
            "volume_vs_avg": float(tech.volume_vs_adv or 1.0),
            "gap_pct": 0.0,
            "ema9": tech.ema9,
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

    _ref_et = bars[-1].timestamp if bars else datetime.now(timezone.utc)
    _ipm, _mob = vwap_session_flags_et(_ref_et)
    payload_stub: dict[str, Any] = {
        "symbol": sym,
        "mode": "day",
        "regime": regime,
        "sector_signal": sector.sector_signal,
        "news_catalyst": nc,
        "catalyst_headlines": _build_catalyst_headlines(news_rows),
        "news_verdict": news.verdict,
        "news_sentiment_score": float(news.weighted_sentiment or 0.0),
        "geopolitical_verdict": geo.verdict,
        "geo_high_impact_count": int(getattr(geo, "high_impact_count", 0) or 0),
        "market_open": _market_open_now(),
        "vwap_session_is_pre_market": _ipm,
        "vwap_session_market_open": _mob,
        "intraday_bar_count": len(bars),
        "vwap_state": getattr(tech, "vwap_state", None),
        "vwap_state_tooltip": getattr(tech, "vwap_state_tooltip", None),
        "vwap_display": getattr(tech, "vwap_chip", None),
        "intraday_bars": [
            {"high": b.high, "low": b.low, "close": b.close, "volume": b.volume} for b in bars
        ],
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
    if response_body.get("status") == "incomplete":
        _LOG.warning(
            "incomplete signal %s missing=%s",
            sym,
            ",".join(response_body.get("missing_fields") or []),
        )

    _score_0_100_preview = int(round((float(composite.score) + 1.0) * 50.0))
    _score_0_100_preview = max(0, min(100, _score_0_100_preview))
    _is_complete = response_body.get("status") != "incomplete"
    _LOG.info(
        "composite scored symbol=%s score=%s verdict=%s alignment=%.2f complete=%s",
        sym,
        _score_0_100_preview,
        composite.verdict.value,
        float(composite.alignment_ratio),
        _is_complete,
    )

    if direction_out:
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
                rr_raw = response_body.get("risk_reward")
                rr_f = float(rr_raw) if isinstance(rr_raw, (int, float)) else None
                if rr_raw is not None and rr_f is None:
                    try:
                        rr_f = float(rr_raw)
                    except (TypeError, ValueError):
                        rr_f = None
                eligible, gates = evaluate_day_ledger_entry(
                    response_status=str(response_body.get("status") or "active"),
                    verdict=composite.verdict,
                    composite_score=float(composite.score),
                    alignment_ratio=float(composite.alignment_ratio),
                    macro_market_regime=str(macro.market_regime or "neutral"),
                    risk_reward=rr_f,
                    intraday_bar_count=len(bars),
                    orb_signal=str(tech.orb_signal or "").strip() or None,
                    vwap_state=str(getattr(tech, "vwap_state", None) or "").strip() or None,
                )
                gen_at = datetime.now(timezone.utc)
                if eligible:
                    if not is_day_ledger_entry_session_et(gen_at):
                        eligible = False
                        gates["entry_session_timing"] = {
                            "pass": False,
                            "need": "us_regular_session_only",
                        }
                    else:
                        dv = float(sym_snap.day_volume) if sym_snap and sym_snap.day_volume else 0.0
                        if dv < MIN_SESSION_VOLUME_SHARES_DAY_LEDGER:
                            eligible = False
                            gates["session_liquidity"] = {
                                "pass": False,
                                "day_volume": dv,
                                "min": MIN_SESSION_VOLUME_SHARES_DAY_LEDGER,
                            }
                    if eligible and user_id:
                        if get_signal_recorder().has_open_validation_position(user_id, sym, "day"):
                            eligible = False
                            gates["dedupe_open_position"] = {
                                "pass": False,
                                "reason": "one_open_validation_per_symbol_mode",
                            }
                ny_date = gen_at.astimezone(ZoneInfo("America/New_York")).date().isoformat()
                setup_type = (
                    str(tech.orb_signal).strip()
                    if tech.orb_signal
                    else (str(getattr(tech, "vwap_state", None) or "").strip() or None)
                )
                rb = response_body
                stop_lvl = rb.get("reference_stop_level")
                ref_struct = rb.get("reference_target_1")
                try:
                    stop_f = float(stop_lvl) if stop_lvl is not None else None
                except (TypeError, ValueError):
                    stop_f = None
                try:
                    ref_struct_f = float(ref_struct) if ref_struct is not None else None
                except (TypeError, ValueError):
                    ref_struct_f = None
                rwk = build_regime_window_key(str(macro.market_regime or "neutral"), gen_at)
                record = SignalRecord(
                    signal_id=str(uuid4()),
                    symbol=sym,
                    direction=str(composite.verdict.value),
                    signal_strength=strength,
                    pattern=str(tech.orb_signal or "real_composite"),
                    layer_scores=layer_scores,
                    price_at_signal=price_at,
                    generated_at=gen_at,
                    user_id=user_id,
                    parameter_version=params.version,
                    technical_snapshot_json=blobs.get("technical_snapshot_json"),
                    news_snapshot_json=blobs.get("news_snapshot_json"),
                    macro_snapshot_json=blobs.get("macro_snapshot_json"),
                    sector_snapshot_json=blobs.get("sector_snapshot_json"),
                    internals_snapshot_json=blobs.get("internals_snapshot_json"),
                    layer_scores_json=blobs.get("layer_scores_json"),
                    status=str(response_body.get("status") or "active"),
                    mode="day",
                    ledger_qualified=eligible,
                    gate_status_json=gate_blob_json(gates, qualified=eligible),
                    entry_rationale=entry_rationale_from_gates(eligible, "day"),
                    decision_state_entry="actionable" if eligible else None,
                    ledger_entry_date_et=ny_date if eligible else None,
                    setup_type=setup_type,
                    stop_level=stop_f,
                    reference_structure_level=ref_struct_f,
                    regime_label_at_entry=str(macro.market_regime or "neutral"),
                    sector_label_at_entry=str(getattr(sector, "sector_signal", None) or sector.verdict or ""),
                    vwap_state_at_entry=str(getattr(tech, "vwap_state", None) or "") or None,
                    regime_window_key=rwk,
                    ledger_position_open=bool(eligible),
                )
                if eligible:
                    get_signal_recorder().record_signal(record)
                else:
                    _LOG.info("day ledger row skipped (gates) symbol=%s", sym)
                if record.status != "active":
                    return response_body
                if eligible and user_id and user_email and direction_out:
                    from stocvest.api.services.alert_tasks import run_alert_background
                    from stocvest.services.alert_trigger import get_alert_trigger

                    def _fire_alert() -> None:
                        get_alert_trigger().trigger_signal_alert(
                            user_id=user_id or "",
                            user_email=user_email or "",
                            symbol=sym,
                            direction=direction_out,
                            signal_strength=strength,
                            pattern=str(tech.orb_signal or "real_composite"),
                            is_confluence=bool(response_body.get("is_confluence_alert")),
                            confluence_score=int(response_body.get("confluence_score") or 0),
                        )

                    run_alert_background(_fire_alert)

            except Exception as exc:
                _LOG.warning("record_signal skipped: %s", exc)

    response_body["decision_state"] = derive_decision_state(
        response_status=str(response_body.get("status") or "active"),
        verdict=composite.verdict,
    )
    return response_body


def real_composite_body_sync(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None = None,
    params: SignalParameters | None = None,
) -> dict[str, Any]:
    """Sync entry for Lambda handler (isolated event loop per invocation)."""
    p = params or ParameterStore.get_parameters_sync()
    return asyncio.run(
        build_real_composite_response(
            symbol=symbol,
            user_id=user_id,
            user_email=user_email,
            params=p,
        )
    )

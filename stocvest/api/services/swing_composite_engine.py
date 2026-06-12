"""Swing-mode real composite: same six layers, daily bars + extended news/macro windows."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any
from uuid import uuid4

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.services.composite_layer_detail_wire import technical_indicator_snapshot_wire
from stocvest.api.services.composite_sector_wire import sector_layer_api_extras
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.api.services.real_composite_engine import (
    _benzinga_articles_to_rows,
    _build_catalyst_headlines,
    _market_open_now,
    _merge_benzinga_first_news_rows,
    _regime_for_engine,
    _safe_result,
    _score_to_layer_signal,
    _snapshot_mark_price,
)
from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.api.services.signal_snapshot_builders import build_real_composite_snapshot_payload
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.services.execution_quality import build_execution_quality_payload
from stocvest.api.services.market_environment import build_market_environment_from_macro
from stocvest.api.services.planning_gates import build_planning_gates_payload
from stocvest.api.services.ledger_gate_attempt import persist_ledger_gate_attempt
from stocvest.api.services.ledger_study_capture import (
    evaluation_source_for_ledger_capture,
    maybe_persist_ledger_study_row,
)
from stocvest.api.services.signal_validation_eligibility import (
    derive_decision_state,
    entry_rationale_from_gates,
    evaluate_swing_ledger_entry,
    gate_blob_json,
)
from stocvest.api.services.validation_timing import (
    build_regime_window_key,
    is_swing_ledger_entry_window_et,
)
from stocvest.api.services.swing_composite_evidence import (
    build_swing_composite_evidence_fields,
    serialize_daily_bars_for_range,
)
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.benzinga_client import BenzingaClient, BenzingaMultiResult, benzinga_multi_shell, ensure_analyst_feed
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.data.earnings_calendar import merge_earnings_horizon_into_response, resolve_upcoming_earnings_horizon
from stocvest.signals.fundamental_context import build_fundamental_context
from stocvest.signals.setup_judgment import build_setup_judgment
from stocvest.analytics.unlock_forecast import (
    composite_bias_from_summary,
    compute_unlock_forecast,
    derive_missing_layers,
    unlock_hints_to_api,
)
from stocvest.signals.laggard_assembler import compute_laggard_signal
from stocvest.signals.causal_narrative import build_causal_narrative
from stocvest.signals.multi_timeframe import apply_multi_timeframe_to_composite
from stocvest.data.models import Bar, SignalRecord, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.data.symbol_normalize import to_polygon_symbol
from stocvest.data.corporate_actions import recent_split_symbols, symbols_with_frequent_reverse_splits
from stocvest.data.market_context_flags import resolve_market_context_flags
from stocvest.signals.market_context_composite_dampener import apply_market_context_composite_dampening
from stocvest.data.symbol_universe_eligibility import UniverseEligibilityContext, universe_exclusion_reason
from stocvest.data.ticker_reference_cache import get_ticker_reference
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields, normalize_direction
from stocvest.signals.composite_score import (
    CompositeVerdict,
    LayerSignal,
    build_composite_score_engine_from_params,
    resolve_composite_block,
)
from stocvest.signals.alignment_score import adjust_composite_with_alignment, alignment_to_response_dict
from stocvest.signals.layer_directional_alignment import composite_direction_fields
from stocvest.signals.geo_analyzer import GeoAnalyzer
from stocvest.signals.internals_analyzer import InternalsAnalyzer
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.signals.macro_context import get_macro_context
from stocvest.signals.news_analyzer import NewsAnalyzer
from stocvest.signals.news_sentiment import SWING_NEWS_LOOKBACK_HOURS
from stocvest.signals.sector_analyzer import SectorAnalyzer
from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.signals.sector_momentum import (
    SectorMomentumScore,
    compute_swing_sector_score,
    session_details_from_returns,
)
from stocvest.workers.sector_daily_cache import get_all_cached_sector_data, get_cached_sector_returns
from stocvest.signals.indicator_scope import finalize_swing_technical_chips
from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer
from stocvest.signals.vwap_state import vwap_session_flags_et
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
    ledger_capture: bool = False,
) -> dict[str, Any]:
    # Polygon's REST endpoints reject the dash form of class-share tickers
    # (BRK-B → 404), so canonicalise once at engine entry. Without this
    # the technical and sector layers silently went `unavailable` for
    # BRK-B / BRK-A / RDS-A / BF-B etc., and the composite collapsed to
    # neutral. See stocvest/data/symbol_normalize.py for the full rule.
    sym = to_polygon_symbol(symbol)
    settings = get_settings()
    sector_cache = DynamoSectorCache(settings.dynamodb_sector_cache_table)
    benzinga = BenzingaClient()
    # Swing news window: five-session headline context (not intraday 8h).
    news_since = datetime.now(timezone.utc) - timedelta(hours=float(SWING_NEWS_LOOKBACK_HOURS))
    econ_end = date.today() + timedelta(days=max(0, int(params.swing_macro_events_days) - 1))
    sic_bucket_for_geo: str | None = None
    sector_resolution_state: SectorResolutionState | None = None
    sic_mapping_tier: SicMappingTier | None = None
    earnings_horizon = None

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        daily_r, sym_r, news_r, spy_r, qqq_r, vix_r, econ_r, bz_r = await asyncio.gather(
            client.get_bars(sym, Timeframe.DAY_1, limit=params.swing_technical.daily_bars_lookback),
            client.get_snapshot(sym),
            client.get_market_news(tickers=[sym], limit=50, published_utc_gte=news_since),
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
            get_vix_snapshot_with_fallback(client),
            client.get_economic_calendar_range(date.today(), econ_end),
            benzinga.get_multi(sym, mode="swing"),
            return_exceptions=True,
        )

        daily_bars: list[Bar] = _safe_result(daily_r, [])
        sym_snap: Snapshot | None = _safe_result(sym_r, None)
        news_polygon: list[dict[str, Any]] = _safe_result(news_r, [])
        bz_data: BenzingaMultiResult = _safe_result(bz_r, benzinga_multi_shell())
        bz_data = await ensure_analyst_feed(benzinga, sym, bz_data)
        news_rows = _merge_benzinga_first_news_rows(news_polygon, _benzinga_articles_to_rows(bz_data.news))
        spy_snap: Snapshot | None = _safe_result(spy_r, None)
        qqq_snap: Snapshot | None = _safe_result(qqq_r, None)
        vix_snap: Snapshot | None = _safe_result(vix_r, None)
        econ = _safe_result(econ_r, [])

        sector_snap: Snapshot | None = None
        sector_display: str | None = None
        sector_etf_sym: str = ""
        spy_week_bars: list[Bar] = []
        sector_week_bars: list[Bar] = []
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

        earnings_horizon = await resolve_upcoming_earnings_horizon(sym, polygon_client=client)

        ref_r, splits_r, freq_rev_r = await asyncio.gather(
            get_ticker_reference(client, sym),
            recent_split_symbols(client),
            symbols_with_frequent_reverse_splits(client),
            return_exceptions=True,
        )
        ticker_ref = _safe_result(ref_r, None)
        recent_splits = _safe_result(splits_r, frozenset())
        frequent_reverse = _safe_result(freq_rev_r, frozenset())

    exclusion = universe_exclusion_reason(
        sym,
        UniverseEligibilityContext(
            snapshot=sym_snap,
            reference=ticker_ref,
            recent_split_symbols=recent_splits if isinstance(recent_splits, frozenset) else frozenset(),
            frequent_reverse_split_symbols=frequent_reverse if isinstance(frequent_reverse, frozenset) else frozenset(),
        ),
        mode="swing",
    )
    if exclusion:
        return {
            "symbol": sym,
            "status": "liquidity_filtered",
            "decision_state": "blocked",
            "available_layers": 0,
            "required_layers": 3,
            "message": (
                f"Symbol does not meet minimum universe eligibility for swing evaluation ({exclusion}). "
                "Micro-cap, low-volume, and high-risk names are excluded before composite scoring."
            ),
            "market_status": fetch_composite_market_status_payload_sync(),
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "mode": "swing",
        }

    all_sector_daily = get_all_cached_sector_data()
    sector_momentum: SectorMomentumScore | None = None
    if sector_resolution_state not in (None, SectorResolutionState.PENDING_REFRESH):
        eff = (sector_etf_sym or "SPY").strip().upper()
        if eff:
            sector_momentum = compute_swing_sector_score(
                eff,
                sic_bucket_for_geo or "default",
                get_cached_sector_returns(eff) or [],
                all_sector_daily,
            )

    snap_for_tech = sym_snap if sym_snap is not None else Snapshot(symbol=sym)
    tech = SwingTechnicalAnalyzer().analyze(sym, daily_bars, snap_for_tech, params.swing_technical)
    _chips_before_audit = list(getattr(tech, "chips", None) or [])
    _chips_clean = finalize_swing_technical_chips(sym, _chips_before_audit)
    if set(_chips_before_audit) != set(_chips_clean):
        _LOG.warning(
            "swing_composite_intraday_chip_leak symbol=%s removed=%s",
            sym,
            list(set(_chips_before_audit) - set(_chips_clean)),
        )
    tech.chips = _chips_clean
    news = NewsAnalyzer().analyze(
        sym,
        news_rows,
        params.news,
        mode="swing",
        benzinga_data=bz_data,
        current_price=_snapshot_mark_price(sym_snap),
    )
    macro_ctx = await get_macro_context(polygon_econ_events=econ)
    macro = MacroAnalyzer().analyze(
        spy_snap,
        qqq_snap,
        vix_snap,
        econ,
        params.macro,
        events_lookback_days=params.swing_macro_events_days,
        macro_context=macro_ctx,
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
        resolution_state=sector_resolution_state,
        sector_momentum=sector_momentum,
        mode="swing",
    )
    geo = GeoAnalyzer().analyze(
        news_rows, lookback_hours=params.swing_geo_lookback_hours, sector_bucket=sic_bucket_for_geo
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
    swing_composite = resolve_composite_block(params, mode="swing")
    min_layers = int(swing_composite.min_available_layers)
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
            "mode": "swing",
        }

    signals: list[LayerSignal] = []
    for lid, res in zip(layer_ids, layer_results):
        sig = _score_to_layer_signal(lid, getattr(res, "score", None), getattr(res, "status", ""))
        if sig is not None:
            signals.append(sig)

    regime = _regime_for_engine(macro.market_regime)
    engine = build_composite_score_engine_from_params(params, mode="swing")
    composite_raw = engine.compute(signals, regime=regime)
    sector_persist = float(sector_momentum.persistence) if sector_momentum else 0.5
    composite, alignment = adjust_composite_with_alignment(
        composite_raw,
        macro_verdict=str(macro.verdict or "neutral"),
        macro_regime=str(macro.market_regime or "neutral"),
        sector_verdict=str(sector.verdict or "neutral"),
        sector_persistence=sector_persist,
        technical_verdict=str(tech.verdict or "neutral"),
        bullish_threshold=float(swing_composite.bullish_threshold),
        bearish_threshold=float(swing_composite.bearish_threshold),
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

    ctx_flags = resolve_market_context_flags(sym, reference=ticker_ref)
    composite, damp_meta = apply_market_context_composite_dampening(
        composite,
        ctx_flags,
        bullish_threshold=float(swing_composite.bullish_threshold),
        bearish_threshold=float(swing_composite.bearish_threshold),
    )

    composite, weekly_timeframe, timeframe_alignment = apply_multi_timeframe_to_composite(
        composite,
        technical_verdict=str(tech.verdict or "neutral"),
        daily_bars=daily_bars,
        bullish_threshold=float(swing_composite.bullish_threshold),
        bearish_threshold=float(swing_composite.bearish_threshold),
        mode="swing",
    )

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
            row["analyst_consensus"] = getattr(res, "analyst_consensus", None)
            row["analyst_feed_state"] = getattr(res, "analyst_feed_state", None)
            row["headline_sentiment"] = getattr(res, "headline_sentiment", None)
            row["analyst_sub_score"] = getattr(res, "analyst_sub_score", None)
            qa = list(getattr(res, "quality_articles", []) or [])
            if qa:
                row["quality_articles"] = qa
            rr = list(getattr(res, "recent_ratings", []) or [])
            if rr:
                row["recent_ratings"] = rr
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
            snap = technical_indicator_snapshot_wire(res, mode="swing")
            if snap:
                row["indicator_snapshot"] = snap
        if lid == "macro":
            row["macro_warnings"] = list(getattr(res, "macro_warnings", None) or [])
            row["macro_risk_level"] = getattr(res, "macro_risk_level", None)
            row["upcoming_events"] = list(getattr(res, "upcoming_events", None) or [])
            row["yield_curve"] = getattr(res, "yield_curve", None)
        if lid == "internals":
            row["breadth_signal"] = getattr(res, "breadth_signal", None)
            row["participation"] = getattr(res, "participation", None)
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
                    sector_etf=sector_etf_sym or None,
                    sector_display_name=sector_display,
                    sector_bucket=sic_bucket_for_geo,
                )
            )
        layers_out.append(row)

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
        "signal_basis": "daily_bars_rth",
        "signal_basis_label": "Derived from daily bars (RTH)",
        "signal_valid_days": 5,
        "signal_expires": expires_at.replace(microsecond=0).isoformat(),
        "alignment_ratio": composite.alignment_ratio,
        "conflicted_layers": list(composite.conflicted_layers or []),
        "market_context_flags": resolve_market_context_flags(sym, reference=ticker_ref),
    }
    if damp_meta:
        response_body["market_context_dampening"] = damp_meta
    response_body["alignment"] = alignment_to_response_dict(alignment)
    response_body.update(composite_direction_fields(response_body))
    response_body["weekly_timeframe"] = weekly_timeframe
    response_body["timeframe_alignment"] = timeframe_alignment
    response_body["causal_narrative"] = build_causal_narrative(
        signal_summary=str(composite.verdict.value),
        layers=layers_out,
    )
    merge_earnings_horizon_into_response(response_body, earnings_horizon)
    if getattr(sector, "score", None) is not None:
        response_body["sector_layer_score"] = int(sector.score)

    try:
        cb = composite_bias_from_summary(str(composite.verdict.value))
        layer_raw = {str(row.get("layer") or ""): row for row in layers_out}
        missing_layers = derive_missing_layers(layers_out, composite_bias=cb)
        unlock_hints = compute_unlock_forecast(
            missing_layers=missing_layers,
            layer_raw_data=layer_raw,
            composite_bias=cb,
        )
        response_body["unlock_forecast"] = unlock_hints_to_api(unlock_hints)
    except Exception as exc:
        _LOG.warning("unlock_forecast_failed symbol=%s err=%s", sym, type(exc).__name__)
        response_body["unlock_forecast"] = []

    try:
        response_body["setup_judgment"] = build_setup_judgment(
            mode="swing",
            layers=layers_out,
            signal_summary=str(composite.verdict.value),
            alignment_ratio=float(composite.alignment_ratio),
            unlock_forecast=response_body.get("unlock_forecast"),
            tech_result=tech,
            bars=daily_bars,
        )
    except Exception as exc:
        _LOG.warning("setup_judgment_failed symbol=%s err=%s", sym, type(exc).__name__)
        response_body["setup_judgment"] = None

    response_body["fundamental_context"] = None
    if user_id:
        try:
            profile = get_user_profile_store().get_profile(user_id)
            if profile is not None and profile.has_full_access:
                fctx = await build_fundamental_context(
                    sym,
                    benzinga_multi=bz_data,
                    sector_display_name=sector_display,
                    sector_etf=sector_etf_sym or None,
                )
                response_body["fundamental_context"] = fctx.to_api_dict()
        except Exception as exc:
            _LOG.warning("fundamental_context_failed symbol=%s err=%s", sym, type(exc).__name__)

    response_body["laggard_signal"] = None
    try:
        snap_move_1d = (
            float(sym_snap.change_percent)
            if sym_snap is not None and sym_snap.change_percent is not None
            else None
        )
        snap_vol = (
            float(sym_snap.day_volume)
            if sym_snap is not None and sym_snap.day_volume is not None
            else None
        )
        earnings_risk = str(response_body.get("earnings_risk") or "").strip().lower()
        response_body["laggard_signal"] = await compute_laggard_signal(
            symbol=sym,
            news_verdict=news.verdict,
            has_earnings_risk=earnings_risk in ("imminent", "elevated"),
            tech_score=float(tech.score) if tech.score is not None else 0.0,
            symbol_move_1d=snap_move_1d,
            symbol_vol_today=snap_vol,
            mode="swing",
        )
    except Exception as exc:
        _LOG.warning("laggard_signal_failed symbol=%s err=%s", sym, type(exc).__name__)

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

    cf: Any = None
    cf_subset: dict[str, Any] | None = None
    if direction_out:
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
            internals_signal=normalize_direction(getattr(internals, "verdict", "neutral")),
        )
        response_body.update(confluence_result_to_response_fields(cf))
        cf_subset = {
            "confirming_signals": response_body.get("confirming_signals"),
            "conflicting_signals": response_body.get("conflicting_signals"),
            "n_confirming": response_body.get("n_confirming"),
            "n_conflicting": response_body.get("n_conflicting"),
        }

    _sw_et = datetime.now(ZoneInfo("America/New_York"))
    _sw_ipm, _sw_mob = vwap_session_flags_et(_sw_et)
    _market_env = build_market_environment_from_macro(mode="swing", macro=macro, vix_snap=vix_snap)
    payload_stub: dict[str, Any] = {
        "symbol": sym,
        "mode": "swing",
        "market_environment": _market_env,
        "regime": regime,
        "sector_signal": sector.sector_signal,
        "news_catalyst": nc,
        "catalyst_headlines": _build_catalyst_headlines(news_rows),
        "news_verdict": news.verdict,
        "news_sentiment_score": float(news.weighted_sentiment or 0.0),
        "geopolitical_verdict": geo.verdict,
        "geo_high_impact_count": int(getattr(geo, "high_impact_count", 0) or 0),
        "market_open": _market_open_now(),
        "vwap_session_is_pre_market": _sw_ipm,
        "vwap_session_market_open": _sw_mob,
        "intraday_bar_count": 0,
        "daily_bars_range": serialize_daily_bars_for_range(daily_bars, limit=10),
    }
    _tech_atr = getattr(tech, "atr", None)
    if _tech_atr is not None:
        try:
            _atr_f = float(_tech_atr)
            if _atr_f > 0:
                payload_stub["atr"] = round(_atr_f, 4)
        except (TypeError, ValueError):
            pass
    # Entry-zone synthesis inputs: config (Secrets Manager) + swing anchors (SMA).
    payload_stub["entry_zone_config"] = asdict(params.entry_zone)
    for _k, _v in (("sma20", getattr(tech, "sma20", None)), ("sma50", getattr(tech, "sma50", None))):
        if isinstance(_v, (int, float)) and float(_v) > 0:
            payload_stub[_k] = round(float(_v), 4)
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
            "incomplete swing signal %s missing=%s",
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

    _rr_eq_raw = response_body.get("risk_reward")
    _rr_eq: float | None = float(_rr_eq_raw) if isinstance(_rr_eq_raw, (int, float)) else None
    _gen_at_eq = datetime.now(timezone.utc)
    _execution_quality = build_execution_quality_payload(
        mode="swing",
        price_at_signal=float(last_px) if last_px else None,
        reference_stop_level=(
            float(response_body["reference_stop_level"])
            if response_body.get("reference_stop_level") is not None
            else None
        ),
        reference_target_1=(
            float(response_body["reference_target_1"])
            if response_body.get("reference_target_1") is not None
            else None
        ),
        risk_reward=_rr_eq,
        atr=getattr(tech, "atr", None),
        volume_ratio=getattr(tech, "volume_vs_adv", None),
        orb_signal=None,
        vwap_state=str(getattr(tech, "vwap_state", None) or response_body.get("vwap_state") or "").strip()
        or None,
        ref_utc=_gen_at_eq,
    )
    response_body["execution_quality"] = _execution_quality
    if payload_stub.get("atr") is not None:
        response_body["atr"] = payload_stub["atr"]
    response_body["market_environment"] = _market_env
    response_body["planning_gates"] = build_planning_gates_payload(
        mode="swing",
        market_regime=str(response_body.get("market_regime") or "Neutral"),
        risk_reward=_rr_eq,
        execution_quality=_execution_quality,
        reference_stop_provenance=str(response_body.get("reference_stop_provenance") or "") or None,
        atr=payload_stub.get("atr"),
        setup_judgment=response_body.get("setup_judgment")
        if isinstance(response_body.get("setup_judgment"), dict)
        else None,
        ref_utc=_gen_at_eq,
        market_environment=_market_env,
    )
    response_body["generated_at"] = _gen_at_eq.replace(microsecond=0).isoformat()
    _eval_src = evaluation_source_for_ledger_capture(ledger_capture)

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
                _sector_gate_score = (
                    float(sector.score) if getattr(sector, "score", None) is not None else None
                )
                eligible, gates = evaluate_swing_ledger_entry(
                    response_status=str(response_body.get("status") or "active"),
                    verdict=composite.verdict,
                    composite_score=float(composite.score),
                    alignment_ratio=float(composite.alignment_ratio),
                    macro_market_regime=str(macro.market_regime or "neutral"),
                    risk_reward=rr_f,
                    layer_scores=layer_scores,
                    sector_layer_score=_sector_gate_score,
                    market_environment=_market_env,
                )
                gen_at = datetime.now(timezone.utc)
                if eligible:
                    if not is_swing_ledger_entry_window_et(gen_at):
                        eligible = False
                        gates["entry_daily_close_window"] = {
                            "pass": False,
                            "need": "post_regular_close_window_et",
                        }
                    if eligible and user_id:
                        if get_signal_recorder().has_open_validation_position(user_id, sym, "swing"):
                            eligible = False
                            gates["dedupe_open_position"] = {
                                "pass": False,
                                "reason": "one_open_validation_per_symbol_mode",
                            }
                ny_date = gen_at.astimezone(ZoneInfo("America/New_York")).date().isoformat()
                rb = response_body
                stop_lvl = rb.get("reference_stop_level")
                ref_t1 = rb.get("reference_target_1")
                try:
                    stop_f = float(stop_lvl) if stop_lvl is not None else None
                except (TypeError, ValueError):
                    stop_f = None
                try:
                    ref_struct_f = float(ref_t1) if ref_t1 is not None else None
                except (TypeError, ValueError):
                    ref_struct_f = None
                rwk = build_regime_window_key(str(macro.market_regime or "neutral"), gen_at)
                record = SignalRecord(
                    signal_id=str(uuid4()),
                    symbol=sym,
                    direction=str(composite.verdict.value),
                    signal_strength=strength,
                    pattern=pattern,
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
                    mode="swing",
                    ledger_qualified=eligible,
                    gate_status_json=gate_blob_json(
                        gates,
                        qualified=eligible,
                        execution_quality=_execution_quality,
                        evaluation_source=_eval_src,
                        market_environment=_market_env,
                    ),
                    entry_rationale=entry_rationale_from_gates(eligible, "swing"),
                    decision_state_entry="actionable" if eligible else None,
                    ledger_entry_date_et=ny_date if eligible else None,
                    stop_level=stop_f,
                    reference_structure_level=ref_struct_f,
                    regime_label_at_entry=str(macro.market_regime or "neutral"),
                    sector_label_at_entry=str(getattr(sector, "sector_signal", None) or sector.verdict or ""),
                    vwap_state_at_entry=(
                        str(rb.get("vwap_state") or getattr(tech, "vwap_state", None) or "").strip() or None
                    ),
                    regime_window_key=rwk,
                    ledger_position_open=bool(eligible),
                )
                persist_ledger_gate_attempt(record, ledger_capture=ledger_capture, mode="swing")
                response_body["ledger_qualified"] = eligible
                response_body["gate_status"] = gates
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
                            pattern=pattern,
                            is_confluence=bool(response_body.get("is_confluence_alert")),
                            confluence_score=int(response_body.get("confluence_score") or 0),
                            macro_regime=str(macro.market_regime or "neutral"),
                            ledger_qualified=True,
                        )

                    run_alert_background(_fire_alert)

            except Exception as exc:
                _LOG.warning("swing record_signal skipped: %s", exc)

    if ledger_capture and user_id and "ledger_qualified" not in response_body:
        try:
            layer_scores_neutral = {s.layer: float(s.score) for s in signals}
            blobs_neutral = build_real_composite_snapshot_payload(
                technical=tech,
                news=news,
                macro=macro,
                sector=sector,
                internals=internals,
                layer_scores=layer_scores_neutral,
                confirming_labels=[],
                conflicting_labels=[],
            )
            rb = response_body
            stop_lvl = rb.get("reference_stop_level")
            ref_t1 = rb.get("reference_target_1")
            try:
                stop_f_n = float(stop_lvl) if stop_lvl is not None else None
            except (TypeError, ValueError):
                stop_f_n = None
            try:
                ref_struct_f_n = float(ref_t1) if ref_t1 is not None else None
            except (TypeError, ValueError):
                ref_struct_f_n = None
            eligible_n, gates_n = maybe_persist_ledger_study_row(
                ledger_capture=True,
                user_id=user_id,
                mode="swing",
                symbol=sym,
                response_status=str(response_body.get("status") or "active"),
                verdict=composite.verdict,
                composite_score=float(composite.score),
                alignment_ratio=float(composite.alignment_ratio),
                macro_market_regime=str(macro.market_regime or "neutral"),
                risk_reward=_rr_eq,
                price_at_signal=float(last_px) if last_px else None,
                layer_scores=layer_scores_neutral,
                sector_layer_score=(
                    float(sector.score) if getattr(sector, "score", None) is not None else None
                ),
                signal_strength=int(round(max(0.0, min(1.0, composite.confidence)) * 100)),
                pattern=pattern,
                params=params,
                snapshot_blobs=blobs_neutral,
                layer_scores_json=blobs_neutral.get("layer_scores_json"),
                setup_type=None,
                stop_level=stop_f_n,
                reference_structure_level=ref_struct_f_n,
                regime_label=str(macro.market_regime or "neutral"),
                sector_label=str(getattr(sector, "sector_signal", None) or sector.verdict or ""),
                vwap_state_at_entry=str(rb.get("vwap_state") or getattr(tech, "vwap_state", None) or "").strip()
                or None,
                atr=getattr(tech, "atr", None),
                volume_ratio=getattr(tech, "volume_vs_adv", None),
                market_environment=_market_env,
            )
            response_body["ledger_qualified"] = eligible_n
            response_body["gate_status"] = gates_n
        except Exception as exc:
            _LOG.warning("swing ledger study capture (neutral) skipped: %s", exc)

    from stocvest.api.services.execution_actionable import apply_entry_gates_to_response_body

    if last_px:
        response_body.setdefault("last_trade_price", last_px)
    apply_entry_gates_to_response_body(response_body, mode="swing")
    return response_body


def swing_composite_body_sync(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None = None,
    params: SignalParameters | None = None,
    ledger_capture: bool = False,
) -> dict[str, Any]:
    p = params or ParameterStore.get_parameters_sync()
    return asyncio.run(
        build_swing_composite_response(
            symbol=symbol,
            user_id=user_id,
            user_email=user_email,
            params=p,
            ledger_capture=ledger_capture,
        )
    )

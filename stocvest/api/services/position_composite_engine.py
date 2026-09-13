"""Position-mode composite: seven layers (fundamentals + six shared types) on weekly structure."""

from __future__ import annotations

import asyncio
import dataclasses
from datetime import date, datetime, timedelta, timezone
from typing import Any

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.services.benzinga_feed_health import (
    apply_news_degraded_if_feed_failed,
    composite_layers_meta,
)
from stocvest.api.services.composite_layer_detail_wire import technical_indicator_snapshot_wire
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.composite_sector_wire import sector_layer_api_extras
from stocvest.api.services.layer_verdict_bands import layer_verdict_band
from stocvest.api.services.market_environment import build_market_environment_from_macro
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.api.services.position_composite_geometry import build_position_composite_geometry_fields
from stocvest.api.services.symbol_perplexity_enrichment import resolve_analyst_target_levels
from stocvest.api.services.real_composite_engine import (
    _regime_for_engine,
    _safe_result,
    _snapshot_mark_price,
)
from stocvest.api.services.swing_news_source import (
    SWING_NEWS_SOURCE_POLYGON_PRIMARY,
    swing_news_source_bundle,
)
from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.earnings_calendar import (
    POSITION_EARNINGS_WINDOW_DAYS,
    merge_earnings_horizon_into_response,
    resolve_upcoming_earnings_horizon,
)
from stocvest.data.fundamentals_provider import (
    FundamentalsProviderMock,
    fetch_position_fundamentals_snapshot,
    get_fundamentals_provider,
)
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.data.signal_snapshots import news_snapshot_from_quality_articles
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.data.symbol_normalize import to_polygon_symbol
from stocvest.data.ticker_reference_cache import get_ticker_reference
from stocvest.signals.causal_narrative import build_causal_narrative
from stocvest.signals.composite_score import (
    CompositeVerdict,
    LayerSignal,
    build_composite_score_engine_from_params,
    resolve_composite_block,
)
from stocvest.signals.day_technical_close_fallback import composite_confidence_for_technical_status
from stocvest.signals.fundamental_context import build_fundamental_context
from stocvest.signals.geo_analyzer import GeoAnalyzer
from stocvest.signals.internals_analyzer import InternalsAnalyzer
from stocvest.signals.layer_directional_alignment import composite_direction_fields
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.signals.macro_context import get_macro_context
from stocvest.signals.news_analyzer import NewsAnalyzer
from stocvest.signals.news_sentiment_cache import (
    enrich_rows_with_cached_impact,
    enrich_rows_with_cached_sentiment,
    prime_missing_news_sentiment,
)
from stocvest.signals.position_fundamentals_analyzer import (
    PositionFundamentalsAnalyzer,
    PositionFundamentalsContext,
)
from stocvest.signals.position_technical_analyzer import (
    PositionTechnicalAnalyzer,
    aggregate_daily_to_weekly_bars,
)
from stocvest.api.services.position_analyst_panel import build_position_analyst_panel
from stocvest.signals.position_holder_read import build_position_holder_read
from stocvest.signals.position_thesis_packet import build_position_thesis_packet
from stocvest.signals.sector_analyzer import SectorAnalyzer
from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState
from stocvest.signals.sector_momentum import (
    SectorMomentumScore,
    compute_swing_sector_score,
    session_details_from_returns,
)
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.workers.sector_daily_cache import get_all_cached_sector_data, get_cached_sector_returns

_LOG = get_logger(__name__)

_COMPOSITE_INSUFFICIENT_MESSAGE = (
    "Insufficient market data to generate a reliable position read. "
    "Fundamentals, technical, and macro context require at least 4 of 7 layers."
)


def _position_layer_gate(status: str) -> bool:
    """Layers that satisfy the insufficient-data gate (includes partial fundamentals)."""
    st = str(status or "").strip().lower()
    return st in ("available", "as_of_close", "active", "degraded")


def resolve_position_signal_basis(
    tech_available: bool, tech_verdict: str
) -> tuple[str, bool]:
    """Honest headline basis label + structure-broken flag for the Long Term read.

    The weekly technical layer can read bearish (price below SMA50/SMA200) even when the
    fundamentals pillars are strong. The old static "Derived from weekly structural trend"
    label claimed an uptrend that may not exist; this reflects the actual technical state so
    the copy and the validity caveat stay honest. Pure/testable.
    """
    verdict = str(tech_verdict or "").strip().lower()
    if not tech_available:
        return "Fundamentals-led read — weekly trend unavailable.", False
    if verdict == "bearish":
        return (
            "Weekly structure is broken (price below its weekly trend) — "
            "fundamentals-led read, not a confirmed uptrend.",
            True,
        )
    if verdict == "neutral":
        return "Weekly structure is mixed — fundamentals-led read with a neutral trend.", False
    return "Derived from weekly structural trend + fundamentals.", False


# Long-horizon sector relative-strength window (~one quarter of weekly bars).
POSITION_SECTOR_RS_WEEKS = 13


def _avg_weekly_pct_from_daily_bars(bars: list[Bar], weeks: int = POSITION_SECTOR_RS_WEEKS) -> float | None:
    """Average weekly % move over ~``weeks`` weeks, from daily bars.

    The long-horizon sector layer asks "is this sector leading or lagging SPY over
    the last quarter?" — not "this week". We take the total return over ``weeks*5``
    sessions (oldest vs newest) and divide by ``weeks`` to get an *average weekly*
    figure, so the value stays dimensionally comparable to the ~1-week thresholds
    ``SectorAnalyzer`` already uses (no threshold re-calibration / invented math).
    """
    sessions = weeks * 5
    if len(bars) < sessions + 1:
        return None
    ordered = sorted(bars, key=lambda b: b.timestamp)
    closes = [b.close for b in ordered]
    old, new = closes[-(sessions + 1)], closes[-1]
    if old <= 0:
        return None
    total_pct = (new / old - 1.0) * 100.0
    return total_pct / weeks


def _position_score_to_layer_signal(layer: str, score: int | None, status: str) -> LayerSignal | None:
    st = str(status or "").strip().lower()
    if st == "degraded":
        return None
    if score is None:
        return None
    if layer == "technical":
        confidence = composite_confidence_for_technical_status(status)
    elif layer == "fundamentals":
        confidence = 1.0 if st == "active" else 0.0
    else:
        confidence = 1.0 if st == "available" else 0.0
    if confidence <= 0:
        return None
    raw = (float(score) - 50.0) / 50.0
    raw = max(-1.0, min(1.0, raw))
    return LayerSignal(layer=layer, score=raw, confidence=confidence)


async def build_position_composite_response(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None,
    params: SignalParameters,
    fundamentals_provider: FundamentalsProviderMock | None = None,
) -> dict[str, Any]:
    _ = user_email
    sym = to_polygon_symbol(symbol)
    settings = get_settings()
    sector_cache = DynamoSectorCache(settings.dynamodb_sector_cache_table)
    news_since = datetime.now(timezone.utc) - timedelta(hours=float(params.position_news_lookback_hours))
    econ_end = date.today() + timedelta(days=max(0, int(params.position_macro_events_days) - 1))
    sic_bucket_for_geo: str | None = None
    sector_resolution_state: SectorResolutionState | None = None
    sic_mapping_tier: SicMappingTier | None = None
    sector_display: str | None = None
    sector_etf_sym: str = ""
    earnings_horizon = None

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        daily_r, sym_r, news_r, spy_r, qqq_r, vix_r, econ_r, ref_r, spy_daily_r = await asyncio.gather(
            client.get_bars(sym, Timeframe.DAY_1, limit=params.position_daily_bars_lookback),
            client.get_snapshot(sym),
            client.get_market_news(tickers=[sym], limit=50, published_utc_gte=news_since),
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
            get_vix_snapshot_with_fallback(client),
            client.get_economic_calendar_range(date.today(), econ_end),
            get_ticker_reference(client, sym),
            client.get_bars("SPY", Timeframe.DAY_1, limit=params.position_daily_bars_lookback),
            return_exceptions=True,
        )

        daily_bars: list[Bar] = _safe_result(daily_r, [])
        sym_snap: Snapshot | None = _safe_result(sym_r, None)
        news_polygon: list[dict[str, Any]] = _safe_result(news_r, [])
        bz_data = swing_news_source_bundle()
        news_rows = list(news_polygon)
        enrich_rows_with_cached_sentiment(news_rows)
        enrich_rows_with_cached_impact(news_rows)
        await prime_missing_news_sentiment(news_rows)
        spy_snap: Snapshot | None = _safe_result(spy_r, None)
        qqq_snap: Snapshot | None = _safe_result(qqq_r, None)
        vix_snap: Snapshot | None = _safe_result(vix_r, None)
        econ = _safe_result(econ_r, [])
        ticker_ref = _safe_result(ref_r, None)
        spy_daily_bars: list[Bar] = _safe_result(spy_daily_r, [])

        sector_snap: Snapshot | None = None
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
                        ticker_ref=ticker_ref,
                    )
                )
                sector_etf_sym = (etf or "").strip().upper()
                if sector_etf_sym and sector_resolution_state != SectorResolutionState.PENDING_REFRESH:
                    # ~13 weeks of daily bars (+buffer) for long-horizon sector RS.
                    _rs_bars = POSITION_SECTOR_RS_WEEKS * 5 + 5
                    sector_snap_r, spy_bars_r = await asyncio.gather(
                        client.get_snapshot(etf),
                        client.get_bars("SPY", Timeframe.DAY_1, limit=_rs_bars),
                        return_exceptions=True,
                    )
                    sector_snap = _safe_result(sector_snap_r, None)
                    spy_week_bars = _safe_result(spy_bars_r, [])
                    if sector_snap is not None:
                        sb = await client.get_bars(etf, Timeframe.DAY_1, limit=_rs_bars)
                        sector_week_bars = _safe_result(sb, [])
            except (PolygonError, Exception) as exc:
                _LOG.warning("position sector chain failed for %s: %s", sym, exc)

        earnings_horizon = await resolve_upcoming_earnings_horizon(
            sym, polygon_client=client, window_days=POSITION_EARNINGS_WINDOW_DAYS
        )

    spy_weekly = aggregate_daily_to_weekly_bars(spy_daily_bars, "SPY")
    snap_for_tech = sym_snap if sym_snap is not None else Snapshot(symbol=sym)
    # Flag-gated position-technical gap fixes (default OFF → structural score unchanged).
    position_technical_params = dataclasses.replace(
        params.position_technical,
        weekly_momentum_confirm_enabled=settings.stocvest_position_weekly_momentum_confirm_enabled,
        volume_confirm_enabled=settings.stocvest_position_volume_confirm_enabled,
    )
    tech = PositionTechnicalAnalyzer().analyze(
        sym,
        daily_bars,
        snap_for_tech,
        position_technical_params,
        spy_weekly_bars=spy_weekly,
    )

    prov = fundamentals_provider if fundamentals_provider is not None else get_fundamentals_provider()
    fund_snapshot = await fetch_position_fundamentals_snapshot(sym, provider=prov)
    fund_ctx = PositionFundamentalsContext(
        sector_bucket=sic_bucket_for_geo,
        fundamentals_v2=settings.stocvest_position_fundamentals_v2_enabled,
        valuation_peg=settings.stocvest_position_valuation_peg_enabled,
    )
    fundamentals = PositionFundamentalsAnalyzer().analyze(fund_snapshot, context=fund_ctx)

    news = NewsAnalyzer().analyze(
        sym,
        news_rows,
        params.news,
        mode="position",
        lookback_hours=int(params.position_news_lookback_hours),
        benzinga_data=bz_data,
        current_price=_snapshot_mark_price(sym_snap),
    )
    news = apply_news_degraded_if_feed_failed(news, bz_data)
    macro_ctx = await get_macro_context(polygon_econ_events=econ)
    macro = MacroAnalyzer().analyze(
        spy_snap,
        qqq_snap,
        vix_snap,
        econ,
        params.macro,
        events_lookback_days=params.position_macro_events_days,
        macro_context=macro_ctx,
        mode="position",
    )

    # `sector_momentum` (swing 1d/5d persistence) is still computed for the API
    # display extras below, but the long-horizon SCORE uses a ~13-week average
    # weekly relative-strength instead — so we pass `sector_momentum=None` into the
    # scorer to bypass the short-horizon persistence path.
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

    w_sec = _avg_weekly_pct_from_daily_bars(sector_week_bars) if params.position_sector_use_weekly else None
    w_spy = _avg_weekly_pct_from_daily_bars(spy_week_bars) if params.position_sector_use_weekly else None
    sector = SectorAnalyzer().analyze(
        sym,
        sector_snap,
        spy_snap,
        params.sector,
        sector_display_name=sector_display,
        use_weekly=params.position_sector_use_weekly,
        weekly_sector_pct=w_sec,
        weekly_spy_pct=w_spy,
        resolution_state=sector_resolution_state,
        sector_momentum=None,
        mode="position",
    )
    geo = GeoAnalyzer().analyze(
        news_rows,
        lookback_hours=params.position_geo_lookback_hours,
        sector_bucket=sic_bucket_for_geo,
        ticker_ref=ticker_ref,
    )
    internals = InternalsAnalyzer().analyze(vix_snap, spy_snap, qqq_snap, params.macro, mode="position")

    layer_results = [fundamentals, tech, news, macro, sector, geo, internals]
    layer_ids = [
        "fundamentals",
        "technical",
        "news",
        "macro",
        "sector",
        "geopolitical",
        "internals",
    ]
    available = [r for r in layer_results if _position_layer_gate(getattr(r, "status", ""))]
    position_composite = resolve_composite_block(params, mode="position")
    min_layers = int(position_composite.min_available_layers)  # type: ignore[attr-defined]
    if len(available) < min_layers:
        insufficient_body = {
            "symbol": sym,
            "status": "insufficient_data",
            "decision_state": "blocked",
            "available_layers": len(available),
            "required_layers": min_layers,
            "message": _COMPOSITE_INSUFFICIENT_MESSAGE,
            "market_status": fetch_composite_market_status_payload_sync(),
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "mode": "position",
            "position_fundamentals": fundamentals.to_api_dict(),
        }
        if ticker_ref is not None:
            insufficient_body["instrument_type"] = ticker_ref.security_type
            insufficient_body["is_fund_vehicle"] = ticker_ref.is_fund_vehicle()
        merge_earnings_horizon_into_response(insufficient_body, earnings_horizon)
        insufficient_body["position_thesis_packet"] = build_position_thesis_packet(
            insufficient_body
        ).to_api_dict()
        return insufficient_body

    signals: list[LayerSignal] = []
    for lid, res in zip(layer_ids, layer_results):
        sig = _position_score_to_layer_signal(lid, getattr(res, "score", None), getattr(res, "status", ""))
        if sig is not None:
            signals.append(sig)

    regime = _regime_for_engine(macro.market_regime)
    engine = build_composite_score_engine_from_params(params, mode="position")
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
        row: dict[str, Any] = {
            "layer": lid,
            "status": getattr(res, "status", "unavailable"),
            "score": getattr(res, "score", None),
            "verdict": getattr(res, "verdict", "neutral"),
            "reasoning": getattr(res, "reasoning", ""),
            "chips": list(getattr(res, "chips", []) or []),
        }
        band = layer_verdict_band(lid, params, mode="position")
        if band is not None:
            row["bearish_threshold"], row["bullish_threshold"] = band
        if lid == "fundamentals":
            row["data_quality"] = getattr(res, "data_quality", "unavailable")
            row["weakest_pillar_id"] = getattr(res, "weakest_pillar_id", None)
            if str(getattr(res, "status", "")).strip().lower() == "degraded":
                row["excluded_from_composite"] = True
        if lid == "news":
            row["article_count"] = int(getattr(res, "article_count", 0) or 0)
            ds = str(getattr(res, "data_state", "fresh") or "fresh")
            row["data_state"] = ds
            if str(getattr(res, "status", "")).strip().lower() == "degraded":
                row["excluded_from_composite"] = True
        if lid == "technical":
            snap = technical_indicator_snapshot_wire(res, mode="position")
            if snap:
                row["indicator_snapshot"] = snap
        if lid == "macro":
            row["macro_warnings"] = list(getattr(res, "macro_warnings", None) or [])
            row["macro_risk_level"] = getattr(res, "macro_risk_level", None)
            row["upcoming_events"] = list(getattr(res, "upcoming_events", None) or [])
        if lid == "geopolitical":
            row["geo_exposure_summary"] = getattr(res, "geo_exposure_summary", None)
            row["geo_exposure_band"] = getattr(res, "geo_exposure_band", None)
        if lid == "internals":
            row["breadth_signal"] = getattr(res, "breadth_signal", None)
        if lid == "sector":
            ds = None
            if sector_momentum:
                ds = session_details_from_returns(get_cached_sector_returns(sector_momentum.etf) or [])
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

    valid_days = int(params.position_signal_valid_days)
    expires_at = datetime.now(timezone.utc) + timedelta(days=valid_days)

    # Honest basis label + structure-broken flag: the weekly technical layer can be bearish
    # (price below SMA50/SMA200) even while fundamentals read well, so the headline must not
    # claim a "structural trend" that isn't there, and the validity window must be caveated.
    basis_label, structure_broken = resolve_position_signal_basis(
        _position_layer_gate(getattr(tech, "status", "")),
        str(getattr(tech, "verdict", "") or ""),
    )

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
        "mode": "position",
        "signal_basis": "weekly_bars_structural",
        "signal_basis_label": basis_label,
        "signal_structure_broken": structure_broken,
        "signal_valid_days": valid_days,
        "signal_expires": expires_at.replace(microsecond=0).isoformat(),
        "alignment_ratio": composite.alignment_ratio,
        "conflicted_layers": list(composite.conflicted_layers or []),
        "position_fundamentals": fundamentals.to_api_dict(),
        "news_source": SWING_NEWS_SOURCE_POLYGON_PRIMARY,
    }
    response_body.update(composite_layers_meta(layer_results, layer_ids, mode="position"))
    response_body.update(composite_direction_fields(response_body))
    # POS-AI-9 capture: persist a dated news snapshot (article published_at + sentiment)
    # so the offline decay-tuning study can join each headline's age to the realized
    # ledger outcome. Behaviour-neutral — the composite score is already computed above.
    response_body["news_snapshot_json"] = news_snapshot_from_quality_articles(
        article_count=int(getattr(news, "article_count", 0) or 0),
        weighted_sentiment=getattr(news, "weighted_sentiment", None),
        catalyst_type=getattr(news, "catalyst_type", None),
        catalyst_headline=getattr(news, "catalyst_headline", None),
        quality_articles=list(getattr(news, "quality_articles", []) or []),
    ).model_dump_json()
    response_body["causal_narrative"] = build_causal_narrative(
        signal_summary=str(composite.verdict.value),
        layers=layers_out,
    )
    merge_earnings_horizon_into_response(response_body, earnings_horizon)
    if ticker_ref is not None:
        response_body["instrument_type"] = ticker_ref.security_type
        response_body["is_fund_vehicle"] = ticker_ref.is_fund_vehicle()

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
            _LOG.warning("position fundamental_context_failed symbol=%s err=%s", sym, exc)

    if composite.verdict == CompositeVerdict.BULLISH:
        response_body["direction"] = "long"
    elif composite.verdict == CompositeVerdict.BEARISH:
        response_body["direction"] = "short"
    else:
        response_body["direction"] = ""

    last_px = _snapshot_mark_price(sym_snap)
    _market_env = build_market_environment_from_macro(mode="position", macro=macro, vix_snap=vix_snap)
    _analyst_levels, _analyst_source = await resolve_analyst_target_levels(
        symbol=sym,
        ticker_ref=ticker_ref,
        ratings=list(getattr(bz_data, "ratings", None) or []),
        current_price=last_px if last_px and last_px > 0 else None,
        allow_perplexity=False,
    )
    geometry_fields = build_position_composite_geometry_fields(
        symbol=sym,
        composite=composite,
        daily_bars=daily_bars,
        snapshot=sym_snap,
        tech=tech,
        analyst_target_levels=_analyst_levels or None,
        analyst_target_source=_analyst_source,
        market_environment=_market_env,
    )
    response_body.update(geometry_fields)
    response_body["market_environment"] = _market_env
    response_body["composite_score"] = composite.score
    response_body["verdict"] = composite.verdict.value

    from stocvest.api.services.execution_actionable import apply_entry_gates_to_response_body

    if last_px:
        response_body.setdefault("last_trade_price", last_px)
    apply_entry_gates_to_response_body(response_body, mode="position")

    # POS-AI-1/AI-2: glass-box thesis packet from the fully-populated body (pillars + layers + verdict).
    response_body["position_thesis_packet"] = build_position_thesis_packet(response_body).to_api_dict()

    # Holder / position-management read (ship dark; OFF until legal sign-off). Owner-oriented
    # guidance derived from the desk's own signals; omitted entirely when the flag is off.
    if settings.stocvest_position_holder_read_enabled:
        holder_read = build_position_holder_read(response_body)
        if holder_read is not None:
            response_body["position_holder_read"] = holder_read

    # POS-AI-13 (display-only; ship dark, default OFF). Attach a Benzinga analyst
    # panel for the Long Term deep-dive. Purely additive — the composite score above
    # is untouched (News-layer bundle stays empty per ADR-001). Byte-identical body
    # when the flag is off; degrades to an "unconfigured" panel without a key.
    if settings.stocvest_position_composite_analyst_enabled:
        response_body["position_analyst"] = await build_position_analyst_panel(
            sym,
            current_price=last_px if last_px and last_px > 0 else None,
        )

    # PORTFOLIO-MGMT Slice 3b — portfolio-aware deep-dive. When the caller already holds
    # this name, attach an owner context (YOUR cost basis, unrealized P/L, tax
    # holding-period, and the signal-first action) built from this very composite body.
    # Additive + best-effort: never fails the composite, and absent for non-holders.
    # Gated on personal-advice mode (the owner card surfaces a buy/hold/trim/sell action);
    # omitted entirely — like the rest of the position advice surface — before external release.
    if user_id and settings.stocvest_personal_advice_mode_enabled:
        try:
            from stocvest.api.services.holdings_store import get_holdings_store
            from stocvest.api.services.portfolio_review import build_owner_position_context

            held = next(
                (h for h in get_holdings_store().list_holdings(user_id) if h.symbol == sym),
                None,
            )
            if held is not None:
                response_body["position_owner"] = build_owner_position_context(
                    body=response_body,
                    holding=held,
                    current_price=last_px if last_px and last_px > 0 else None,
                )
        except Exception as exc:  # noqa: BLE001 — owner context is best-effort
            _LOG.warning("position_owner attach failed symbol=%s err=%s", sym, exc)

    return response_body


def position_composite_body_sync(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None = None,
    params: SignalParameters | None = None,
    fundamentals_provider: FundamentalsProviderMock | None = None,
) -> dict[str, Any]:
    p = params or ParameterStore.get_parameters_sync()
    return asyncio.run(
        build_position_composite_response(
            symbol=symbol,
            user_id=user_id,
            user_email=user_email,
            params=p,
            fundamentals_provider=fundamentals_provider,
        )
    )

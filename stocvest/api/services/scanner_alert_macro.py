"""Macro regime snapshot for scheduled scanner email gating."""

from __future__ import annotations

import asyncio
from datetime import date

from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data import PolygonClient
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.signals.macro_context import get_macro_context
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def fetch_macro_regime_for_scanner_alerts(client: PolygonClient) -> str:
    """``MacroAnalyzer.market_regime`` (includes ``avoid`` when VIX > high band)."""
    try:
        params = default_signal_parameters()
        spy, qqq = await asyncio.gather(
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
        )
        vix = await get_vix_snapshot_with_fallback(client)
        econ = await client.get_economic_calendar_for_day(date.today())
        macro_ctx = await get_macro_context(polygon_econ_events=econ)
        macro = MacroAnalyzer().analyze(
            spy,
            qqq,
            vix,
            econ,
            params.macro,
            events_lookback_days=1,
            macro_context=macro_ctx,
        )
        return str(macro.market_regime or "neutral")
    except Exception as exc:  # noqa: BLE001 — email gating must not break scan
        _LOG.warning("scanner alert macro regime fallback: %s", exc)
        return "neutral"

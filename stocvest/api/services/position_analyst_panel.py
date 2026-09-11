"""POS-AI-13 (display-only): analyst ratings panel for the Long Term desk.

Fetches Benzinga analyst ratings for a symbol and formats them with the same
presenter the ticker news panel uses (``format_analyst_ratings_for_panel``).

This is a DISPLAY-only surface: it never feeds the position composite score.
The News-layer bundle in ``position_composite_engine`` stays empty per ADR-001,
so wiring this panel in is score-neutral. When no Benzinga analyst key is
configured (or the fetch fails/times out), the panel degrades to an
``unconfigured`` / ``empty`` feed_state rather than raising.
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.services.analyst_panel_format import format_analyst_ratings_for_panel
from stocvest.data.benzinga_client import BenzingaClient, BenzingaRating
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_ANALYST_WINDOW_DAYS = 30
_FETCH_TIMEOUT_S = 2.5


async def build_position_analyst_panel(
    symbol: str,
    *,
    current_price: float | None = None,
) -> dict[str, Any]:
    """Return a display-only analyst panel dict for ``symbol``.

    Never raises: any fetch failure degrades to an empty ratings list so the
    panel simply reports ``unconfigured``/``empty``.
    """
    sym = symbol.strip().upper()
    settings = get_settings()
    configured = bool(settings.benzinga_analyst_key.strip())

    ratings: list[BenzingaRating] = []
    if configured and sym:
        try:
            client = BenzingaClient()
            ratings = await asyncio.wait_for(
                client.get_analyst_ratings(sym, days=_ANALYST_WINDOW_DAYS),
                timeout=_FETCH_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001 — analyst display is best-effort
            _LOG.debug("position analyst panel fetch failed symbol=%s err=%s", sym, exc)
            ratings = []

    return format_analyst_ratings_for_panel(
        ratings,
        symbol=sym,
        analyst_feed_configured=configured,
        current_price=current_price if current_price and current_price > 0 else None,
    )

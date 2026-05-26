"""Load US equity snapshots for Opportunity Desk funnel (full feed + fallback)."""

from __future__ import annotations

import asyncio

from stocvest.data import PolygonClient, PolygonError
from stocvest.data.models import Snapshot
from stocvest.data.scanner_universe import LIQUID_SYMBOLS_FALLBACK
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

FULL_SNAPSHOT_TIMEOUT_SEC = 12.0


async def load_us_equity_snapshots_for_funnel(
    *,
    timeout_sec: float = FULL_SNAPSHOT_TIMEOUT_SEC,
) -> tuple[list[Snapshot], str]:
    """
    Prefer Polygon full-US snapshot; fall back to liquid symbol batch on timeout/403.

    Returns ``(snapshots, source)`` where ``source`` is ``full_us`` | ``liquid_fallback``.
    """
    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        try:
            if timeout_sec > 0:
                snaps = await asyncio.wait_for(
                    client.get_us_stocks_market_snapshots(include_otc=False),
                    timeout=timeout_sec,
                )
            else:
                snaps = await client.get_us_stocks_market_snapshots(include_otc=False)
            if snaps:
                return snaps, "full_us"
        except TimeoutError:
            _LOG.warning(
                "opportunity_desk full US snapshot exceeded %.0fs; liquid_fallback",
                timeout_sec,
            )
        except PolygonError as exc:
            msg = str(exc)
            if "Polygon 403" in msg or "Polygon 401" in msg:
                _LOG.warning("opportunity_desk aggregate snapshot unavailable: %s", msg[:200])
            else:
                _LOG.warning("opportunity_desk full snapshot failed: %s", msg[:200])
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("opportunity_desk full snapshot error: %s", str(exc)[:200])

        batch = await client.get_snapshots_many(list(LIQUID_SYMBOLS_FALLBACK), chunk_size=50)
        return list(batch.values()), "liquid_fallback"

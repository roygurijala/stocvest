"""Position scan universe builder — ADR-004 POS-D15 (full weekly batch).

Turns a large raw candidate list (FMP company-screener) into the ~N-name, investable
universe the weekly gem scan composites. Two layers:

* :func:`assemble_universe` — **pure**: applies the market-cap / dollar-volume floors and the
  leveraged-inverse / SPAC exclusions (reusing ``position_universe_filter``), de-dupes, sorts
  by market cap desc, and caps to ``max_size``. Falls back to the curated list when the raw
  input yields nothing. Fully unit-testable without network.
* :func:`build_scan_universe` — async, best-effort: fetches the screener, runs the pure
  assembler, and always returns *something* (curated ``POSITION_SCAN_UNIVERSE_V1`` on any
  failure) so the batch never scans an empty universe.

The lite curated universe (``POSITION_SCAN_UNIVERSE_V1``) remains the fallback and the default
for the low-latency invest-page / candidates path; the expanded universe is used by the weekly
batch worker where latency is not user-facing.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from stocvest.api.services.position_scan import POSITION_SCAN_UNIVERSE_V1
from stocvest.signals.position_universe_filter import position_universe_exclusion_reason
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Cap on the scanned universe. ADR-004 targets ~500; kept configurable via settings.
DEFAULT_MAX_UNIVERSE = 500

_ScreenerFetch = Callable[..., Awaitable[list[dict]]]


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n else None


def assemble_universe(
    rows: list[dict] | None,
    *,
    min_market_cap_usd: float,
    min_avg_dollar_volume_usd: float,
    max_size: int = DEFAULT_MAX_UNIVERSE,
    fallback: tuple[str, ...] = POSITION_SCAN_UNIVERSE_V1,
) -> list[str]:
    """Pure: screener rows → investable, capped, market-cap-desc symbol list (fallback if empty)."""
    scored: list[tuple[float, str]] = []
    seen: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym or sym in seen:
            continue
        # Skip fund/ETF wrappers the screener may still include.
        if bool(row.get("isEtf")) or bool(row.get("isFund")):
            continue
        name = str(row.get("companyName") or row.get("name") or "").strip() or None
        market_cap = _to_float(row.get("marketCap"))
        price = _to_float(row.get("price"))
        volume = _to_float(row.get("volume"))
        dollar_volume = price * volume if price is not None and volume is not None else None
        reason = position_universe_exclusion_reason(
            sym,
            company_name=name,
            market_cap=market_cap,
            avg_dollar_volume=dollar_volume,
            min_market_cap_usd=min_market_cap_usd,
            min_avg_dollar_volume_usd=min_avg_dollar_volume_usd,
        )
        if reason is not None:
            continue
        seen.add(sym)
        scored.append((market_cap if market_cap is not None else 0.0, sym))

    if not scored:
        # Nothing usable from the screener → curated fallback (de-duped, order preserved).
        out: list[str] = []
        for s in fallback:
            u = s.strip().upper()
            if u and u not in out:
                out.append(u)
        return out[: max(0, max_size)]

    scored.sort(key=lambda t: (-t[0], t[1]))
    return [sym for _cap, sym in scored[: max(0, max_size)]]


async def build_scan_universe(
    *,
    max_size: int | None = None,
    fetch: _ScreenerFetch | None = None,
) -> list[str]:
    """Best-effort expanded universe for the weekly batch; curated fallback on any failure."""
    settings = get_settings()
    min_cap = float(settings.stocvest_position_min_market_cap_usd)
    min_adv = float(settings.stocvest_position_min_avg_dollar_volume_usd)
    cap = int(max_size if max_size is not None else DEFAULT_MAX_UNIVERSE)

    if fetch is None:
        from stocvest.data.fmp_client import get_position_screener_rows

        fetch = get_position_screener_rows

    try:
        # Fetch a generous slice above the cap so post-exclusion trimming still fills the target.
        rows = await fetch(min_market_cap=min_cap, limit=max(cap * 3, cap))
    except Exception as exc:  # noqa: BLE001 — universe build must never fail the batch
        _LOG.warning("build_scan_universe fetch failed: %s", type(exc).__name__)
        rows = []

    universe = assemble_universe(
        rows,
        min_market_cap_usd=min_cap,
        min_avg_dollar_volume_usd=min_adv,
        max_size=cap,
    )
    _LOG.info("position scan universe built size=%s (raw_rows=%s)", len(universe), len(rows or []))
    return universe

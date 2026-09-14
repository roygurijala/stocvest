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

Live refresh and the weekly batch both hunt mid-caps first (``exclude_mega`` +
``prefer_mid_cap``), then merge the curated mega board for Strong/Monitor. The curated
list is only the fallback when a non-discovery assemble yields nothing.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from stocvest.api.services.position_scan import POSITION_SCAN_UNIVERSE_V1
from stocvest.signals.position_gem_gates import MEGA_CAP_USD
from stocvest.signals.position_universe_filter import position_universe_exclusion_reason
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Cap on the scanned universe. ADR-004 targets ~500; kept configurable via settings.
DEFAULT_MAX_UNIVERSE = 500
# Same large-cap floor as frontend ``earningsImpactLevel`` medium band.
LARGE_CAP_USD = 20_000_000_000.0
# Live async refresh budget (signals Lambda 180s, concurrency 6) + curated mega slice.
# Scan-lite skips news pagination, so the pond can be 40 mid-caps again.
LIVE_DISCOVERY_MAX = 40
# Weekly batch can walk more mid-caps; still excludes mega from the hunt.
BATCH_DISCOVERY_MAX = 200
# FMP sorts by market cap desc. A small limit is the 120 largest names — no mid-caps.
# Discovery fetches a deep non-mega pool, then assemble() picks mid-caps first.
DISCOVERY_FETCH_LIMIT = 1500

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
    exclude_mega: bool = False,
    prefer_mid_cap: bool = False,
) -> list[str]:
    """Pure: screener rows → investable, capped symbol list (fallback if empty).

    Default sort is market-cap desc (legacy). Discovery mode (``exclude_mega`` +
    ``prefer_mid_cap``) drops the $200B+ pond and fills mid-caps first, then
    large-not-mega. Empty discovery input returns ``[]`` (no AAPL fallback) so the
    caller can merge the curated mega slice separately.
    """
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
        cap = market_cap if market_cap is not None else 0.0
        if exclude_mega and cap >= MEGA_CAP_USD:
            continue
        seen.add(sym)
        scored.append((cap, sym))

    if not scored:
        if exclude_mega:
            return []
        # Nothing usable from the screener → curated fallback (de-duped, order preserved).
        out: list[str] = []
        for s in fallback:
            u = s.strip().upper()
            if u and u not in out:
                out.append(u)
        return out[: max(0, max_size)]

    if prefer_mid_cap:
        mid = [(c, s) for c, s in scored if c < LARGE_CAP_USD]
        large = [(c, s) for c, s in scored if c >= LARGE_CAP_USD]
        mid.sort(key=lambda t: (-t[0], t[1]))
        large.sort(key=lambda t: (-t[0], t[1]))
        ordered = mid + large
    else:
        ordered = sorted(scored, key=lambda t: (-t[0], t[1]))
    return [sym for _cap, sym in ordered[: max(0, max_size)]]


def merge_scan_universe(
    discovery: list[str] | None,
    *,
    curated: tuple[str, ...] = POSITION_SCAN_UNIVERSE_V1,
) -> list[str]:
    """Discovery names first, then the curated mega slice (deduped)."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in list(discovery or []) + list(curated):
        sym = str(raw or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


async def build_scan_universe(
    *,
    max_size: int | None = None,
    fetch: _ScreenerFetch | None = None,
    discovery: bool = False,
) -> list[str]:
    """Best-effort universe; curated fallback on any failure unless ``discovery=True``.

    Discovery mode excludes mega-caps and prefers mid-caps. The caller merges the
    curated mega slice via :func:`merge_scan_universe` so Strong/Monitor still has
    a quality large-cap board.
    """
    settings = get_settings()
    min_cap = float(settings.stocvest_position_min_market_cap_usd)
    min_adv = float(settings.stocvest_position_min_avg_dollar_volume_usd)
    cap = int(max_size if max_size is not None else DEFAULT_MAX_UNIVERSE)

    if fetch is None:
        from stocvest.data.fmp_client import get_position_screener_rows

        fetch = get_position_screener_rows

    try:
        # Legacy path: a modest over-fetch above the compose cap.
        # Discovery: a deep non-mega pool so prefer_mid_cap actually sees mid-caps.
        fetch_limit = DISCOVERY_FETCH_LIMIT if discovery else max(cap * 3, cap)
        fetch_kwargs: dict[str, Any] = {"min_market_cap": min_cap, "limit": fetch_limit}
        if discovery:
            fetch_kwargs["max_market_cap"] = MEGA_CAP_USD
        rows = await fetch(**fetch_kwargs)
    except Exception as exc:  # noqa: BLE001 — universe build must never fail the batch
        _LOG.warning("build_scan_universe fetch failed: %s", type(exc).__name__)
        rows = []

    universe = assemble_universe(
        rows,
        min_market_cap_usd=min_cap,
        min_avg_dollar_volume_usd=min_adv,
        max_size=cap,
        exclude_mega=discovery,
        prefer_mid_cap=discovery,
    )
    _LOG.info(
        "position scan universe built size=%s discovery=%s (raw_rows=%s)",
        len(universe),
        discovery,
        len(rows or []),
    )
    return universe


async def build_live_scan_universe(*, fetch: _ScreenerFetch | None = None) -> list[str]:
    """Async-refresh universe: mid-cap discovery + curated mega slice (~65 names)."""
    discovery = await build_scan_universe(max_size=LIVE_DISCOVERY_MAX, fetch=fetch, discovery=True)
    return merge_scan_universe(discovery)


async def build_batch_scan_universe(
    *,
    max_discovery: int | None = None,
    fetch: _ScreenerFetch | None = None,
) -> list[str]:
    """Weekly batch: larger mid-cap hunt + curated mega slice for Strong/Monitor."""
    cap = int(max_discovery if max_discovery is not None else BATCH_DISCOVERY_MAX)
    discovery = await build_scan_universe(max_size=cap, fetch=fetch, discovery=True)
    return merge_scan_universe(discovery)

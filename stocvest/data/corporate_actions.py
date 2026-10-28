"""Polygon corporate-action helpers (stock splits)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING

from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

if TYPE_CHECKING:
    from stocvest.data.polygon_client import PolygonClient

_LOG = get_logger(__name__)

_SPLIT_LOOKBACK_DAYS = 5
_SPLIT_CACHE_TTL_SEC = 6 * 3600
_REVERSE_SPLIT_LOOKBACK_DAYS = 365
_REVERSE_SPLIT_MIN_COUNT = 2
_REVERSE_SPLIT_CACHE_TTL_SEC = 86_400


@dataclass(frozen=True)
class SplitEvent:
    ticker: str
    execution_date: date
    split_from: float
    split_to: float

    @property
    def is_reverse(self) -> bool:
        return self.split_from > self.split_to

    @property
    def ratio(self) -> float:
        """New shares per old share (``apply_stock_split`` convention)."""
        return self.split_to / self.split_from

    @property
    def label(self) -> str:
        to_s = str(int(self.split_to)) if self.split_to == int(self.split_to) else str(self.split_to)
        from_s = (
            str(int(self.split_from)) if self.split_from == int(self.split_from) else str(self.split_from)
        )
        kind = "reverse" if self.is_reverse else "forward"
        return f"{to_s}-for-{from_s} {kind}"


def _split_cache_key(start: date, end: date) -> str:
    return f"stocvest:splits:{start.isoformat()}:{end.isoformat()}"


def _reverse_split_cache_key(start: date, end: date) -> str:
    return f"stocvest:splits:reverse_freq:{start.isoformat()}:{end.isoformat()}"


def _parse_split_row(row: dict) -> SplitEvent | None:
    ticker = str(row.get("ticker") or "").strip().upper()
    if not ticker:
        return None
    raw_date = row.get("execution_date")
    if not raw_date:
        return None
    try:
        ex_date = date.fromisoformat(str(raw_date)[:10])
    except ValueError:
        return None
    try:
        split_from = float(row.get("split_from") or 0)
        split_to = float(row.get("split_to") or 0)
    except (TypeError, ValueError):
        return None
    if split_from <= 0 or split_to <= 0:
        return None
    return SplitEvent(ticker=ticker, execution_date=ex_date, split_from=split_from, split_to=split_to)


async def _fetch_split_events(
    client: PolygonClient,
    *,
    start: date,
    end: date,
) -> list[SplitEvent]:
    events: list[SplitEvent] = []
    params: dict[str, str] = {
        "execution_date.gte": start.isoformat(),
        "execution_date.lte": end.isoformat(),
        "limit": "1000",
        "sort": "execution_date",
        "order": "desc",
    }
    path = "/v3/reference/splits"
    page = 0
    while True:
        try:
            data = await client._get(path, params)  # noqa: SLF001
        except Exception as exc:
            _LOG.warning("corporate_actions splits fetch failed page=%s: %s", page, str(exc)[:200])
            break
        rows = data.get("results") or []
        if not isinstance(rows, list):
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            ev = _parse_split_row(row)
            if ev is not None:
                events.append(ev)
        next_url = data.get("next_url")
        if not next_url or not rows:
            break
        if "cursor=" in str(next_url):
            cursor = str(next_url).split("cursor=", 1)[-1].split("&", 1)[0]
            params = {"cursor": cursor, "limit": "1000"}
        else:
            break
        page += 1
        if page > 20:
            break
    return events


async def fetch_split_symbols(
    client: PolygonClient,
    *,
    start: date,
    end: date,
) -> frozenset[str]:
    """
    Symbols with a stock split between ``start`` and ``end`` (inclusive), from Polygon.

    Results are cached in Redis for a few hours to limit REST volume during desk batches.
    """
    cache_key = _split_cache_key(start, end)
    r = get_sync_redis()
    if r is not None:
        try:
            raw = r.get(cache_key)
            if raw:
                parsed = json.loads(str(raw))
                if isinstance(parsed, list):
                    return frozenset(str(s).strip().upper() for s in parsed if str(s).strip())
        except Exception:
            pass

    events = await _fetch_split_events(client, start=start, end=end)
    symbols = {ev.ticker for ev in events}
    out = frozenset(symbols)
    if r is not None and out:
        try:
            r.set(cache_key, json.dumps(sorted(out)), ex=_SPLIT_CACHE_TTL_SEC)
        except Exception:
            pass
    return out


async def symbols_with_frequent_reverse_splits(
    client: PolygonClient,
    *,
    as_of: date | None = None,
    lookback_days: int = _REVERSE_SPLIT_LOOKBACK_DAYS,
    min_reverse_splits: int = _REVERSE_SPLIT_MIN_COUNT,
) -> frozenset[str]:
    """Symbols with ``min_reverse_splits`` or more reverse splits in the lookback window."""
    end = as_of or date.today()
    start = end - timedelta(days=max(1, lookback_days))
    cache_key = _reverse_split_cache_key(start, end)
    r = get_sync_redis()
    if r is not None:
        try:
            raw = r.get(cache_key)
            if raw:
                parsed = json.loads(str(raw))
                if isinstance(parsed, list):
                    return frozenset(str(s).strip().upper() for s in parsed if str(s).strip())
        except Exception:
            pass

    events = await _fetch_split_events(client, start=start, end=end)
    counts: dict[str, int] = {}
    for ev in events:
        if ev.is_reverse:
            counts[ev.ticker] = counts.get(ev.ticker, 0) + 1
    blocked = frozenset(sym for sym, n in counts.items() if n >= min_reverse_splits)
    if r is not None:
        try:
            r.set(cache_key, json.dumps(sorted(blocked)), ex=_REVERSE_SPLIT_CACHE_TTL_SEC)
        except Exception:
            pass
    return blocked


async def fetch_splits_for_tickers(
    client: PolygonClient,
    tickers: list[str] | tuple[str, ...],
    *,
    start: date,
    end: date,
) -> list[SplitEvent]:
    """Splits for the given tickers in ``[start, end]`` (inclusive). One page per ticker."""
    events: list[SplitEvent] = []
    seen: set[tuple[str, date, float, float]] = set()
    for raw in tickers:
        ticker = str(raw or "").strip().upper()
        if not ticker:
            continue
        params: dict[str, str] = {
            "ticker": ticker,
            "execution_date.gte": start.isoformat(),
            "execution_date.lte": end.isoformat(),
            "limit": "100",
            "sort": "execution_date",
            "order": "desc",
        }
        try:
            data = await client._get("/v3/reference/splits", params)  # noqa: SLF001
        except Exception as exc:
            _LOG.warning("corporate_actions ticker splits failed ticker=%s: %s", ticker, str(exc)[:200])
            continue
        rows = data.get("results") or []
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            ev = _parse_split_row(row)
            if ev is None:
                continue
            key = (ev.ticker, ev.execution_date, ev.split_from, ev.split_to)
            if key in seen:
                continue
            seen.add(key)
            events.append(ev)
    return events


async def recent_split_symbols(
    client: PolygonClient,
    *,
    as_of: date | None = None,
    lookback_days: int = _SPLIT_LOOKBACK_DAYS,
) -> frozenset[str]:
    """Symbols with a split in the last ``lookback_days`` trading-calendar days."""
    end = as_of or date.today()
    start = end - timedelta(days=max(1, lookback_days))
    return await fetch_split_symbols(client, start=start, end=end)

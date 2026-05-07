"""
Federal Reserve Economic Data (FRED) API client.

Findings (Polygon economics check — ``scripts/check_polygon_economic_calendar.py``):
  Polygon ``/benzinga/v1/economics`` can return future-dated rows with ``event_name``,
  ``date``, ``time``, and ``importance``/``impact``. Fed events are inferred from
  name text, not a dedicated tag. We merge those rows as supplemental MacroEvents
  when present; FRED remains authoritative for release dates and Treasury series
  when ``FRED_API_KEY`` is set.

FRED requires an API key for all requests — register at https://fred.stlouisfed.org/docs/api/api_key.html
Without a key, upcoming events fall back to static FOMC placeholders and yield curve is unavailable.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from stocvest.signals.macro_event import (
    MacroEvent,
    MacroEventCategory,
    compute_event_status,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred"
_ET = ZoneInfo("America/New_York")

FRED_SERIES = {
    "treasury_2yr": "DGS2",
    "treasury_10yr": "DGS10",
}

# Release IDs — best-effort; unknown IDs yield empty dates (fallback still applies).
FRED_RELEASES: dict[str, int] = {
    "fomc": 18,
    "cpi": 10,
    "pce": 54,
    "gdp": 53,
    "jobs": 50,
    "retail": 11,
}

RELEASE_IMPORTANCE: dict[str, int] = {
    "fomc": 5,
    "cpi": 5,
    "jobs": 5,
    "pce": 4,
    "gdp": 4,
    "retail": 3,
}

REDIS_PREFIX = "stocvest:fred:"
REDIS_TTL = 86400


class FREDClient:
    def __init__(self) -> None:
        self._timeout = httpx.Timeout(12.0)

    def _api_key(self) -> str:
        return str(get_settings().fred_api_key or "").strip()

    def _redis_get(self, key: str) -> str | None:
        if get_settings().stocvest_disable_redis:
            return None
        try:
            import redis

            r = redis.Redis.from_url(str(get_settings().redis_url), decode_responses=True)
            return r.get(key)
        except Exception:
            return None

    def _redis_set(self, key: str, value: str) -> None:
        if get_settings().stocvest_disable_redis:
            return
        try:
            import redis

            r = redis.Redis.from_url(str(get_settings().redis_url), decode_responses=True)
            r.setex(key, REDIS_TTL, value)
        except Exception as exc:
            _LOG.warning("fred_redis_set_failed error=%s", exc)

    async def get_upcoming_events(self, days_ahead: int = 14) -> list[MacroEvent]:
        cache_key = f"{REDIS_PREFIX}events:{days_ahead}"
        cached = self._redis_get(cache_key)
        if cached:
            try:
                events = [self._dict_to_event(e) for e in json.loads(cached)]
                return [compute_event_status(e) for e in events]
            except Exception:
                pass

        events: list[MacroEvent] = []
        api_key = self._api_key()
        today = date.today()
        end_date = today + timedelta(days=days_ahead)

        if api_key:
            for release_name, release_id in FRED_RELEASES.items():
                try:
                    release_events = await self._fetch_release_dates(
                        api_key,
                        release_id,
                        release_name,
                        today,
                        end_date,
                    )
                    events.extend(release_events)
                except Exception as exc:
                    _LOG.warning("fred_release_fetch_failed release=%s error=%s", release_name, exc)

        if not events:
            _LOG.warning("fred_no_events_using_hardcoded")
            events = self._get_hardcoded_events()

        events.sort(key=lambda e: e.scheduled_time)
        try:
            payload = json.dumps([self._event_to_dict(e) for e in events], default=str)
            self._redis_set(cache_key, payload)
        except Exception:
            pass

        return [compute_event_status(e) for e in events]

    async def _fetch_release_dates(
        self,
        api_key: str,
        release_id: int,
        release_name: str,
        from_date: date,
        to_date: date,
    ) -> list[MacroEvent]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{FRED_BASE}/release/dates",
                params={
                    "api_key": api_key,
                    "release_id": release_id,
                    "realtime_start": from_date.isoformat(),
                    "realtime_end": to_date.isoformat(),
                    "file_type": "json",
                    "include_release_dates_with_no_data": "true",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        out: list[MacroEvent] = []
        for item in data.get("release_dates") or []:
            if not isinstance(item, dict):
                continue
            release_date_str = item.get("date")
            if not release_date_str:
                continue
            try:
                release_date = date.fromisoformat(str(release_date_str)[:10])
            except ValueError:
                continue
            if release_date < from_date:
                continue

            default_times = {
                "fomc": (14, 0),
                "cpi": (8, 30),
                "jobs": (8, 30),
                "pce": (8, 30),
                "gdp": (8, 30),
                "retail": (8, 30),
            }
            hour, minute = default_times.get(release_name, (8, 30))
            scheduled = datetime(
                release_date.year,
                release_date.month,
                release_date.day,
                hour,
                minute,
                0,
                tzinfo=_ET,
            )

            category = {
                "fomc": MacroEventCategory.FED,
                "cpi": MacroEventCategory.CPI,
                "pce": MacroEventCategory.PCE,
                "gdp": MacroEventCategory.GDP,
                "jobs": MacroEventCategory.JOBS,
                "retail": MacroEventCategory.RETAIL,
            }.get(release_name, MacroEventCategory.OTHER)

            out.append(
                MacroEvent(
                    event_id=f"{release_name.upper()}_{release_date_str}",
                    name=self._release_display_name(release_name),
                    category=category,
                    country="US",
                    scheduled_time=scheduled,
                    importance=RELEASE_IMPORTANCE.get(release_name, 3),
                    source="FRED",
                )
            )
        return out

    def _release_display_name(self, key: str) -> str:
        return {
            "fomc": "FOMC Rate Decision",
            "cpi": "CPI Inflation Report",
            "pce": "PCE Price Index",
            "gdp": "GDP Growth Rate",
            "jobs": "Non-Farm Payrolls",
            "retail": "Retail Sales",
        }.get(key, key.upper())

    async def get_yield_curve(self) -> dict[str, Any] | None:
        cache_key = f"{REDIS_PREFIX}yield_curve"
        cached = self._redis_get(cache_key)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                pass

        api_key = self._api_key()
        if not api_key:
            return None

        yields: dict[str, float] = {}
        for name, series_id in FRED_SERIES.items():
            try:
                value = await self._fetch_latest_series(api_key, series_id)
                if value is not None:
                    yields[name] = value
            except Exception as exc:
                _LOG.warning("fred_yield_fetch_failed series=%s error=%s", series_id, exc)

        if "treasury_2yr" not in yields or "treasury_10yr" not in yields:
            return None

        two_yr = yields["treasury_2yr"]
        ten_yr = yields["treasury_10yr"]
        spread = round(ten_yr - two_yr, 3)

        if spread > 0.5:
            regime = "normal"
            label = "Yield curve: normal"
            chip = f"2s10s: +{spread:.2f}%"
        elif spread >= 0:
            regime = "flat"
            label = "Yield curve: flattening"
            chip = f"2s10s: +{spread:.2f}% (flat)"
        else:
            regime = "inverted"
            label = "Yield curve: inverted ⚠️"
            chip = f"2s10s: {spread:.2f}% (inverted)"

        result: dict[str, Any] = {
            "yield_2yr": two_yr,
            "yield_10yr": ten_yr,
            "spread": spread,
            "regime": regime,
            "label": label,
            "chip": chip,
        }
        try:
            self._redis_set(cache_key, json.dumps(result))
        except Exception:
            pass
        return result

    async def _fetch_latest_series(self, api_key: str, series_id: str) -> float | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{FRED_BASE}/series/observations",
                params={
                    "api_key": api_key,
                    "series_id": series_id,
                    "sort_order": "desc",
                    "limit": 1,
                    "file_type": "json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        observations = data.get("observations") or []
        if not observations:
            return None
        value_str = str(observations[0].get("value") or ".")
        if value_str == ".":
            return None
        return float(value_str)

    def _get_hardcoded_events(self) -> list[MacroEvent]:
        now = datetime.now(_ET)
        events: list[MacroEvent] = []
        fomc_dates = [
            "2026-06-17",
            "2026-07-29",
            "2026-09-16",
            "2026-11-04",
            "2026-12-16",
        ]
        for d in fomc_dates:
            dt = datetime.strptime(d, "%Y-%m-%d").replace(hour=14, minute=0, tzinfo=_ET)
            if dt > now:
                events.append(
                    MacroEvent(
                        event_id=f"FOMC_{d}",
                        name="FOMC Rate Decision",
                        category=MacroEventCategory.FED,
                        country="US",
                        scheduled_time=dt,
                        importance=5,
                        source="fallback_static",
                    )
                )
        return events

    def _event_to_dict(self, e: MacroEvent) -> dict[str, Any]:
        return {
            "event_id": e.event_id,
            "name": e.name,
            "category": e.category.value,
            "country": e.country,
            "scheduled_time": e.scheduled_time.isoformat(),
            "importance": e.importance,
            "source": e.source,
        }

    def _dict_to_event(self, d: dict[str, Any]) -> MacroEvent:
        return MacroEvent(
            event_id=str(d["event_id"]),
            name=str(d["name"]),
            category=MacroEventCategory(str(d["category"])),
            country=str(d.get("country") or "US"),
            scheduled_time=datetime.fromisoformat(str(d["scheduled_time"])),
            importance=int(d["importance"]),
            source=str(d.get("source") or "FRED"),
        )

"""Benzinga REST client with resilient fallbacks for signal layers."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from stocvest.data.polygon_client import PolygonClient
from stocvest.data.ticker_name_resolver import article_matches_ticker
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

BENZINGA_BASE = "https://api.benzinga.com/api"


@dataclass
class BenzingaArticle:
    article_id: str
    title: str
    body: str | None
    published_at: datetime
    tickers: list[str]
    channels: list[str]
    source: str = "benzinga"
    url: str | None = None
    weight: float = 1.0


@dataclass
class BenzingaWIMEntry:
    symbol: str
    reason: str
    direction: str
    published_at: datetime
    source: str = "benzinga_wim"


@dataclass
class BenzingaRating:
    symbol: str
    action: str
    rating: str
    price_target: float | None
    analyst_firm: str
    published_at: datetime


@dataclass
class BenzingaGuidance:
    symbol: str
    guidance_type: str
    period: str
    published_at: datetime
    headline: str


@dataclass
class BenzingaEarningsResult:
    symbol: str
    period: str
    eps_actual: float | None
    eps_estimate: float | None
    eps_surprise_pct: float | None
    revenue_actual: float | None
    revenue_estimate: float | None
    beat: bool | None
    reported_at: datetime


@dataclass
class BenzingaMultiResult:
    news: list[BenzingaArticle] = field(default_factory=list)
    wim: BenzingaWIMEntry | None = None
    ratings: list[BenzingaRating] = field(default_factory=list)
    guidance: list[BenzingaGuidance] = field(default_factory=list)
    earnings: list[BenzingaEarningsResult] = field(default_factory=list)
    analyst_feed_configured: bool = False


def benzinga_multi_shell() -> BenzingaMultiResult:
    """Empty Benzinga bundle that still reflects whether the analyst calendar key is configured."""
    return BenzingaMultiResult(
        analyst_feed_configured=bool(get_settings().benzinga_analyst_key.strip())
    )


async def ensure_analyst_feed(
    client: BenzingaClient,
    symbol: str,
    data: BenzingaMultiResult,
) -> BenzingaMultiResult:
    """Recover analyst ratings when get_multi timed out or the ratings sub-call failed."""
    sym = symbol.strip().upper()
    if not sym:
        return data
    if not bool(get_settings().benzinga_analyst_key.strip()):
        return data
    if data.ratings:
        if data.analyst_feed_configured:
            return data
        return BenzingaMultiResult(
            news=data.news,
            wim=data.wim,
            ratings=data.ratings,
            guidance=data.guidance,
            earnings=data.earnings,
            analyst_feed_configured=True,
        )

    try:
        ratings = await asyncio.wait_for(client.get_analyst_ratings(sym), timeout=2.5)
    except Exception:
        ratings = []

    return BenzingaMultiResult(
        news=data.news,
        wim=data.wim,
        ratings=ratings,
        guidance=data.guidance,
        earnings=data.earnings,
        analyst_feed_configured=True,
    )


def _parse_dt(value: object) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _calendar_query_params(
    *,
    token: str,
    symbol: str,
    date_from: date,
    date_to: date,
    pagesize: int = 100,
) -> dict[str, Any]:
    """Benzinga calendar v2.1 expects bracketed parameter names."""
    return {
        "token": token,
        "parameters[tickers]": symbol.strip().upper(),
        "parameters[date_from]": str(date_from),
        "parameters[date_to]": str(date_to),
        "pagesize": max(1, min(1000, int(pagesize))),
    }


def _map_rating_action(action_raw: str) -> str:
    act = str(action_raw or "").lower()
    if "upgrade" in act:
        return "Upgrade"
    if "downgrade" in act:
        return "Downgrade"
    if "maintain" in act or "reiterat" in act:
        return "Maintains"
    if "initiat" in act:
        return "Initiates"
    return act.title() or "Unknown"


def _f(value: object) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


class BenzingaClient:
    def __init__(self) -> None:
        self._timeout = httpx.Timeout(2.0)
        self._settings = get_settings()

    async def _get_json(self, *, path: str, params: dict[str, Any]) -> Any:
        try:
            headers = {"accept": "application/json"} if "/calendar/" in path else None
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                r = await client.get(f"{BENZINGA_BASE}{path}", params=params, headers=headers)
            if r.status_code >= 400:
                _LOG.warning("benzinga_request_failed path=%s status=%s", path, r.status_code)
                return None
            return r.json()
        except Exception as exc:
            _LOG.warning("benzinga_request_error path=%s error=%s", path, type(exc).__name__)
            return None

    async def get_news(self, symbol: str, hours: int = 8, limit: int = 10) -> list[BenzingaArticle]:
        token = (self._settings.benzinga_news_api_key or self._settings.benzinga_api_key).strip()
        if not token:
            return []
        sym = symbol.strip().upper()
        data = await self._get_json(
            path="/v2/news",
            params={
                "token": token,
                "tickers": sym,
                "pageSize": max(1, min(50, int(limit))),
                "displayOutput": "full",
            },
        )
        rows = data if isinstance(data, list) else (data.get("news") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, int(hours)))
        out: list[BenzingaArticle] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            tickers = [str(t).strip().upper() for t in (row.get("tickers") or []) if str(t).strip()]
            if not title:
                continue
            if not article_matches_ticker(title, tickers, sym):
                continue
            pub = _parse_dt(row.get("published_utc") or row.get("created") or row.get("updated"))
            if pub < cutoff:
                continue
            channels = [str(c).strip().upper() for c in (row.get("channels") or []) if str(c).strip()]
            out.append(
                BenzingaArticle(
                    article_id=str(row.get("id") or row.get("article_id") or ""),
                    title=title,
                    body=str(row.get("body") or "").strip() or None,
                    published_at=pub,
                    tickers=tickers,
                    channels=channels,
                    source="benzinga",
                    url=str(row.get("url") or row.get("article_url") or "").strip() or None,
                )
            )
        out.sort(key=lambda a: a.published_at, reverse=True)
        return out[: max(1, min(50, int(limit)))]

    async def get_news_for_symbol_panel(
        self,
        symbol: str,
        *,
        days: int = 20,
        limit: int = 50,
    ) -> list[BenzingaArticle]:
        """Benzinga REST news for the ticker panel (matches composite engine, not WS replay)."""
        token = (self._settings.benzinga_news_api_key or self._settings.benzinga_api_key).strip()
        if not token:
            return []
        sym = symbol.strip().upper()
        window_days = max(1, min(20, int(days)))
        today = datetime.now(timezone.utc).date()
        since_date = today - timedelta(days=window_days)
        since_dt = datetime.combine(since_date, datetime.min.time(), tzinfo=timezone.utc)
        data = await self._get_json(
            path="/v2/news",
            params={
                "token": token,
                "tickers": sym,
                "pageSize": max(1, min(50, int(limit))),
                "displayOutput": "full",
                "dateFrom": str(since_date),
                "dateTo": str(today),
            },
        )
        rows = data if isinstance(data, list) else (data.get("news") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        out: list[BenzingaArticle] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            tickers = [str(t).strip().upper() for t in (row.get("tickers") or []) if str(t).strip()]
            if not title:
                continue
            if not article_matches_ticker(title, tickers, sym):
                continue
            pub = _parse_dt(row.get("published_utc") or row.get("created") or row.get("updated"))
            if pub < since_dt:
                continue
            channels = [str(c).strip().upper() for c in (row.get("channels") or []) if str(c).strip()]
            if sym not in tickers:
                tickers = list(dict.fromkeys([*tickers, sym]))
            out.append(
                BenzingaArticle(
                    article_id=str(row.get("id") or row.get("article_id") or ""),
                    title=title,
                    body=str(row.get("body") or "").strip() or None,
                    published_at=pub,
                    tickers=tickers,
                    channels=channels,
                    source="benzinga",
                    url=str(row.get("url") or row.get("article_url") or "").strip() or None,
                )
            )
        out.sort(key=lambda a: a.published_at, reverse=True)
        return out[: max(1, min(50, int(limit)))]

    async def get_news_with_fallback(self, symbol: str, mode: str = "day") -> list[BenzingaArticle]:
        sym = symbol.strip().upper()
        mode_n = (mode or "day").strip().lower()
        if mode_n == "swing":
            base_hours = 120
            base_limit = 30
        else:
            base_hours = 8
            base_limit = 12
        rows = await self.get_news(sym, hours=base_hours, limit=base_limit)
        if mode_n == "day" and len(rows) < 2:
            ext = await self.get_news(sym, hours=48, limit=30)
            now = datetime.now(timezone.utc)
            weighted: list[BenzingaArticle] = []
            for r in ext:
                age_h = (now - r.published_at).total_seconds() / 3600.0
                if age_h <= 8:
                    w = 1.0
                elif age_h <= 24:
                    w = 0.70
                else:
                    w = 0.40
                weighted.append(BenzingaArticle(**{**r.__dict__, "weight": w}))
            rows = weighted
        elif mode_n == "swing":
            now = datetime.now(timezone.utc)
            weighted = []
            for r in rows:
                age_h = (now - r.published_at).total_seconds() / 3600.0
                if age_h <= 24:
                    w = 1.0
                elif age_h <= 48:
                    w = 0.80
                elif age_h <= 72:
                    w = 0.60
                elif age_h <= 96:
                    w = 0.40
                else:
                    w = 0.25
                weighted.append(BenzingaArticle(**{**r.__dict__, "weight": w}))
            rows = weighted
        if rows:
            return rows
        try:
            _LOG.info("news_source_fallback symbol=%s source=polygon", sym)
            _LOG.info("news_benzinga_empty_fallback_polygon symbol=%s", sym)
            async with PolygonClient(api_key=self._settings.polygon_api_key) as client:
                p_rows = await client.get_market_news(tickers=[sym], limit=20)
            out: list[BenzingaArticle] = []
            for row in p_rows:
                if not isinstance(row, dict):
                    continue
                out.append(
                    BenzingaArticle(
                        article_id=str(row.get("id") or ""),
                        title=str(row.get("title") or "").strip(),
                        body=str(row.get("description") or "").strip() or None,
                        published_at=_parse_dt(row.get("published_utc")),
                        tickers=[str(t).strip().upper() for t in (row.get("tickers") or []) if str(t).strip()],
                        channels=[],
                        source="polygon",
                        url=str(row.get("article_url") or "").strip() or None,
                    )
                )
            return [r for r in out if r.title]
        except Exception:
            return []

    async def get_why_is_it_moving(self, symbol: str) -> BenzingaWIMEntry | None:
        token = self._settings.benzinga_wim_key.strip()
        if not token:
            return None
        sym = symbol.strip().upper()
        data = await self._get_json(
            path="/v2/news",
            params={
                "token": token,
                "tickers": sym,
                "channels": "WIIM",
                "pageSize": 1,
                "displayOutput": "full",
            },
        )
        rows = data if isinstance(data, list) else (data.get("news") if isinstance(data, dict) else [])
        if not isinstance(rows, list) or not rows:
            return None
        row = rows[0] if isinstance(rows[0], dict) else {}
        title = str(row.get("title") or "").lower()
        body = str(row.get("body") or row.get("description") or "").strip()
        blob = f"{title} {body}".lower()
        if any(x in blob for x in ("moving higher", "gaining", "up ", "surges", "rises")):
            direction = "up"
        elif any(x in blob for x in ("moving lower", "falling", "down ", "drops", "declines")):
            direction = "down"
        else:
            direction = "neutral"
        reason = body or str(row.get("title") or "").strip()
        return BenzingaWIMEntry(symbol=sym, reason=reason[:240], direction=direction, published_at=_parse_dt(row.get("published_utc")))

    async def get_analyst_ratings(self, symbol: str, days: int = 30) -> list[BenzingaRating]:
        token = self._settings.benzinga_analyst_key.strip()
        if not token:
            return []
        today = datetime.now(timezone.utc).date()
        since = today - timedelta(days=max(1, int(days)))
        data = await self._get_json(
            path="/v2.1/calendar/ratings",
            params=_calendar_query_params(
                token=token,
                symbol=symbol,
                date_from=since,
                date_to=today,
                pagesize=100,
            ),
        )
        rows = data if isinstance(data, list) else (data.get("ratings") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        sym = symbol.strip().upper()
        out: list[BenzingaRating] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_sym = str(row.get("ticker") or sym).strip().upper()
            if row_sym != sym:
                continue
            action = _map_rating_action(str(row.get("action_company") or row.get("action") or ""))
            out.append(
                BenzingaRating(
                    symbol=row_sym,
                    action=action,
                    rating=str(row.get("rating_current") or row.get("rating") or "").strip(),
                    price_target=_f(row.get("pt_current") or row.get("price_target")),
                    analyst_firm=str(row.get("analyst") or row.get("analyst_firm") or "").strip(),
                    published_at=_parse_dt(row.get("date") or row.get("updated")),
                )
            )
        out.sort(key=lambda r: r.published_at, reverse=True)
        return out

    async def get_corporate_guidance(self, symbol: str, days: int = 30) -> list[BenzingaGuidance]:
        token = self._settings.benzinga_analyst_key.strip()
        if not token:
            return []
        today = datetime.now(timezone.utc).date()
        since = today - timedelta(days=max(1, int(days)))
        data = await self._get_json(
            path="/v2.1/calendar/guidance",
            params=_calendar_query_params(
                token=token,
                symbol=symbol,
                date_from=since,
                date_to=today,
                pagesize=100,
            ),
        )
        rows = data if isinstance(data, list) else (data.get("guidance") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        out: list[BenzingaGuidance] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            g_raw = str(row.get("action") or row.get("guidance_type") or "").lower()
            if any(x in g_raw for x in ("above", "raise")):
                g = "raised"
            elif any(x in g_raw for x in ("below", "cut")):
                g = "lowered"
            elif "in-line" in g_raw:
                g = "in-line"
            elif "initiat" in g_raw:
                g = "initiated"
            else:
                g = g_raw or "unknown"
            out.append(
                BenzingaGuidance(
                    symbol=str(row.get("ticker") or symbol).upper(),
                    guidance_type=g,
                    period=str(row.get("fiscal_period") or row.get("period") or "").strip(),
                    published_at=_parse_dt(row.get("date") or row.get("updated")),
                    headline=str(row.get("title") or row.get("headline") or "").strip(),
                )
            )
        out.sort(key=lambda r: r.published_at, reverse=True)
        return out

    async def get_earnings_results(self, symbol: str, periods: int = 2) -> list[BenzingaEarningsResult]:
        token = self._settings.benzinga_analyst_key.strip()
        if not token:
            return []
        today = datetime.now(timezone.utc).date()
        since = today - timedelta(days=90)
        data = await self._get_json(
            path="/v2.1/calendar/earnings",
            params=_calendar_query_params(
                token=token,
                symbol=symbol,
                date_from=since,
                date_to=today,
                pagesize=100,
            ),
        )
        rows = data if isinstance(data, list) else (data.get("earnings") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        out: list[BenzingaEarningsResult] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            eps_actual = _f(row.get("eps") or row.get("eps_actual"))
            eps_estimate = _f(row.get("eps_est") or row.get("eps_estimate"))
            surprise = None
            beat = None
            if eps_actual is not None and eps_estimate is not None and eps_estimate != 0:
                surprise = round(((eps_actual - eps_estimate) / abs(eps_estimate)) * 100.0, 1)
                beat = eps_actual > eps_estimate
            out.append(
                BenzingaEarningsResult(
                    symbol=str(row.get("ticker") or symbol).upper(),
                    period=str(row.get("fiscal_period") or row.get("period") or "").strip(),
                    eps_actual=eps_actual,
                    eps_estimate=eps_estimate,
                    eps_surprise_pct=surprise,
                    revenue_actual=_f(row.get("revenue") or row.get("revenue_actual")),
                    revenue_estimate=_f(row.get("revenue_est") or row.get("revenue_estimate")),
                    beat=beat,
                    reported_at=_parse_dt(row.get("date") or row.get("updated")),
                )
            )
        out.sort(key=lambda r: r.reported_at, reverse=True)
        return out[: max(1, int(periods))]

    async def get_upcoming_earnings_calendar(self, symbol: str, *, days: int = 30) -> list[date]:
        """Forward-looking earnings dates for ``symbol`` (today through ``days`` ahead)."""
        token = self._settings.benzinga_analyst_key.strip()
        if not token:
            return []
        sym = symbol.strip().upper()
        if not sym:
            return []
        today = datetime.now(timezone.utc).date()
        end = today + timedelta(days=max(1, int(days)))
        data = await self._get_json(
            path="/v2.1/calendar/earnings",
            params=_calendar_query_params(
                token=token,
                symbol=sym,
                date_from=today,
                date_to=end,
                pagesize=100,
            ),
        )
        rows = data if isinstance(data, list) else (data.get("earnings") if isinstance(data, dict) else [])
        if not isinstance(rows, list):
            return []
        out: list[date] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_sym = str(row.get("ticker") or sym).strip().upper()
            if row_sym != sym:
                continue
            raw = row.get("date") or row.get("report_date") or row.get("earnings_date")
            if raw is None:
                continue
            try:
                if isinstance(raw, date):
                    d = raw
                else:
                    s = str(raw).strip()[:10]
                    d = date.fromisoformat(s)
            except ValueError:
                continue
            if today <= d <= end:
                out.append(d)
        return sorted(set(out))

    async def get_multi(self, symbol: str, mode: str = "day") -> BenzingaMultiResult:
        try:
            results = await asyncio.wait_for(
                asyncio.gather(
                    self.get_news_with_fallback(symbol, mode),
                    self.get_why_is_it_moving(symbol),
                    self.get_analyst_ratings(symbol),
                    self.get_corporate_guidance(symbol),
                    self.get_earnings_results(symbol),
                    return_exceptions=True,
                ),
                timeout=6.0,
            )
        except Exception as exc:
            _LOG.warning("benzinga_multi_failed symbol=%s error=%s", symbol, type(exc).__name__)
            return benzinga_multi_shell()

        def safe(val: Any, default: Any) -> Any:
            return default if isinstance(val, Exception) else val

        analyst_configured = bool(self._settings.benzinga_analyst_key.strip())
        return BenzingaMultiResult(
            news=safe(results[0], []),
            wim=safe(results[1], None),
            ratings=safe(results[2], []),
            guidance=safe(results[3], []),
            earnings=safe(results[4], []),
            analyst_feed_configured=analyst_configured,
        )


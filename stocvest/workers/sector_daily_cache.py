"""Pre-fetch daily sector ETF vs SPY relative returns into Redis."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import time
from dataclasses import dataclass
from datetime import date, timedelta

from stocvest.data.models import Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

SECTOR_ETFS_TO_TRACK = [
    "SPY",
    "XLK",
    "XLC",
    "XLE",
    "XLF",
    "XLV",
    "XLY",
    "XLP",
    "XLI",
    "XLRE",
    "XLB",
    "XLU",
    "SMH",
    "KBE",
    "GLD",
]

SECTOR_DAILY_KEY_PREFIX = "stocvest:sector_daily:"
SECTOR_DAILY_TTL = 86400
SECTOR_DAILY_DYNAMO_PREFIX = "DAILY#"


@dataclass
class DailyReturn:
    date: str
    etf_pct: float
    spy_pct: float
    relative: float
    outperformed: bool
    volume_ratio: float


def _bar_date_key(ts) -> str:
    if hasattr(ts, "date"):
        return ts.date().isoformat()
    return str(ts)[:10]


async def fetch_etf_daily_bars(
    ticker: str,
    polygon_client: PolygonClient,
    sessions: int = 7,
) -> list[dict]:
    to_d = date.today()
    from_d = to_d - timedelta(days=max(30, sessions * 3))
    try:
        bars = await polygon_client.get_bars(
            ticker.strip().upper(),
            Timeframe.DAY_1,
            from_date=from_d.isoformat(),
            to_date=to_d.isoformat(),
            limit=max(30, sessions + 5),
        )
    except Exception as exc:
        _LOG.warning("sector_daily_fetch_failed ticker=%s err=%s", ticker, exc)
        return []
    out: list[dict] = []
    for b in bars:
        out.append(
            {
                "date": _bar_date_key(b.timestamp),
                "o": float(b.open),
                "c": float(b.close),
                "v": float(b.volume or 0),
                "vw": float(b.vwap or 0) if b.vwap is not None else 0.0,
            }
        )
    return out


def _spy_by_date(spy_bars: list[dict]) -> dict[str, dict]:
    return {str(b["date"]): b for b in spy_bars}


async def compute_daily_returns_for_etf(
    etf: str,
    spy_bars: list[dict],
    polygon_client: PolygonClient,
) -> list[DailyReturn]:
    if not spy_bars:
        return []
    etf_bars = await fetch_etf_daily_bars(etf, polygon_client, sessions=7)
    spy_map = _spy_by_date(spy_bars)
    aligned: list[tuple[str, dict, dict]] = []
    for eb in etf_bars:
        d = str(eb["date"])
        sb = spy_map.get(d)
        if sb is None:
            continue
        aligned.append((d, eb, sb))
    if len(aligned) < 2:
        return []
    vols = [float(x[1].get("v") or 0) for x in aligned]
    v_mean = sum(vols) / len(vols) if vols else 1.0
    if v_mean <= 0:
        v_mean = 1.0
    daily_returns: list[DailyReturn] = []
    for d, eb, sb in aligned:
        eo, ec = float(eb["o"]), float(eb["c"])
        so, sc = float(sb["o"]), float(sb["c"])
        if eo <= 0 or so <= 0:
            continue
        etf_pct = (ec - eo) / eo * 100.0
        spy_pct = (sc - so) / so * 100.0
        rel = etf_pct - spy_pct
        vol = float(eb.get("v") or 0)
        daily_returns.append(
            DailyReturn(
                date=d,
                etf_pct=round(etf_pct, 4),
                spy_pct=round(spy_pct, 4),
                relative=round(rel, 4),
                outperformed=rel > 0,
                volume_ratio=round(vol / v_mean, 4) if v_mean else 1.0,
            )
        )
    return daily_returns[-5:]


def _sector_daily_dynamo_key(etf: str) -> str:
    return f"{SECTOR_DAILY_DYNAMO_PREFIX}{etf.strip().upper()}"


def _parse_daily_returns_payload(raw: str) -> list[DailyReturn] | None:
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [DailyReturn(**d) for d in data]
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        _LOG.warning("sector_daily_parse_failed error=%s", exc)
        return None


def _write_sector_daily_dynamo(etf: str, returns: list[DailyReturn]) -> None:
    settings = get_settings()
    table_name = (settings.dynamodb_sector_cache_table or "").strip()
    if not table_name or not returns:
        return
    try:
        import boto3

        ttl = int(time.time()) + SECTOR_DAILY_TTL
        payload = json.dumps([dataclasses.asdict(ret) for ret in returns])
        tbl = boto3.resource("dynamodb", region_name=settings.aws_region).Table(table_name)
        tbl.put_item(
            Item={
                "symbol": _sector_daily_dynamo_key(etf),
                "daily_returns_json": payload,
                "expires_at": ttl,
            }
        )
    except Exception as exc:
        _LOG.warning("sector_daily_dynamo_write_failed etf=%s error=%s", etf, exc)


def _read_sector_daily_dynamo(etf: str) -> list[DailyReturn] | None:
    settings = get_settings()
    table_name = (settings.dynamodb_sector_cache_table or "").strip()
    if not table_name:
        return None
    try:
        import boto3

        tbl = boto3.resource("dynamodb", region_name=settings.aws_region).Table(table_name)
        resp = tbl.get_item(Key={"symbol": _sector_daily_dynamo_key(etf)})
        item = resp.get("Item")
        if not item:
            return None
        exp = int(item.get("expires_at") or 0)
        if exp and exp < int(time.time()):
            return None
        raw = item.get("daily_returns_json")
        if not raw:
            return None
        return _parse_daily_returns_payload(str(raw))
    except Exception as exc:
        _LOG.warning("sector_daily_dynamo_read_failed etf=%s error=%s", etf, exc)
        return None


async def _update_sector_daily_cache_with_client(client: PolygonClient) -> dict[str, list[DailyReturn]]:
    results: dict[str, list[DailyReturn]] = {}
    spy_bars = await fetch_etf_daily_bars("SPY", client, sessions=7)
    if not spy_bars:
        return results

    async def one(etf: str) -> tuple[str, list[DailyReturn]]:
        returns = await compute_daily_returns_for_etf(etf, spy_bars, client)
        return etf, returns

    etfs = [e for e in SECTOR_ETFS_TO_TRACK if e != "SPY"]
    pairs = await asyncio.gather(*[one(e) for e in etfs], return_exceptions=True)
    r = get_sync_redis()
    for item in pairs:
        if isinstance(item, Exception):
            _LOG.warning("sector_daily_cache_failed err=%s", item)
            continue
        etf, returns = item
        if not returns:
            continue
        try:
            payload = json.dumps([dataclasses.asdict(ret) for ret in returns])
            if r is not None:
                r.setex(f"{SECTOR_DAILY_KEY_PREFIX}{etf}", SECTOR_DAILY_TTL, payload)
            _write_sector_daily_dynamo(etf, returns)
            results[etf] = returns
            _LOG.info("sector_daily_cached etf=%s sessions=%d", etf, len(returns))
        except Exception as exc:
            _LOG.warning("sector_daily_cache_failed etf=%s error=%s", etf, exc)
    return results


async def update_sector_daily_cache(
    polygon_client: PolygonClient | None = None,
) -> dict[str, list[DailyReturn]]:
    if polygon_client is not None:
        return await _update_sector_daily_cache_with_client(polygon_client)
    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        return await _update_sector_daily_cache_with_client(client)


def get_cached_sector_returns(etf: str) -> list[DailyReturn] | None:
    etf_u = etf.strip().upper()
    try:
        r = get_sync_redis()
        if r is not None:
            cached = r.get(f"{SECTOR_DAILY_KEY_PREFIX}{etf_u}")
            if cached:
                raw = cached.decode() if isinstance(cached, bytes) else str(cached)
                parsed = _parse_daily_returns_payload(raw)
                if parsed:
                    return parsed
    except Exception as exc:
        _LOG.warning("sector_daily_redis_read_failed etf=%s error=%s", etf_u, exc)
    return _read_sector_daily_dynamo(etf_u)


def get_all_cached_sector_data() -> dict[str, list[DailyReturn]]:
    result: dict[str, list[DailyReturn]] = {}
    for etf in SECTOR_ETFS_TO_TRACK:
        if etf == "SPY":
            continue
        returns = get_cached_sector_returns(etf)
        if returns:
            result[etf] = returns
    return result


_ETF_DISPLAY = {
    "XLK": "Tech",
    "XLC": "Comm",
    "XLE": "Energy",
    "XLF": "Financials",
    "XLV": "Health care",
    "XLY": "Cons. disc.",
    "XLP": "Cons. staples",
    "XLI": "Industrials",
    "XLRE": "Real estate",
    "XLB": "Materials",
    "XLU": "Utilities",
    "SMH": "Semis",
    "KBE": "Banks",
    "GLD": "Gold",
}


def write_sector_rotation_dashboard_payload() -> bool:
    """Summarize cached ETF vs SPY returns for Edge dashboard (dual-write to Upstash)."""
    from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache

    sectors: list[dict] = []
    for etf, returns in get_all_cached_sector_data().items():
        if not returns:
            continue
        window = returns[-5:]
        pct_5d = sum(r.etf_pct for r in window)
        last = window[-1]
        rel = float(last.relative)
        if rel > 0.05:
            verdict = "outperforming"
        elif rel < -0.05:
            verdict = "underperforming"
        else:
            verdict = "inline"
        sectors.append(
            {
                "etf": etf,
                "name": _ETF_DISPLAY.get(etf, etf),
                "pct_5d": round(pct_5d, 4),
                "pct_1d": round(float(last.etf_pct), 4),
                "verdict": verdict,
            }
        )
    return write_dashboard_cache(
        DashboardKeys.SECTOR_ROTATION,
        {"sectors": sectors},
        "sector_rotation",
        "swing",
    )


def handler(event, context):
    import asyncio

    _ = event
    _ = context
    logging.getLogger(__name__).info("sector_daily_cache_lambda_start")
    results = asyncio.run(update_sector_daily_cache())
    try:
        write_sector_rotation_dashboard_payload()
    except Exception as exc:
        _LOG.warning("sector_rotation_upstash_failed err=%s", exc)
    return {
        "statusCode": 200,
        "etfs_cached": len(results),
        "etfs": list(results.keys()),
    }

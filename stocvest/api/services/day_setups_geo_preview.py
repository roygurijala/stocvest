"""Attach per-symbol geopolitical preview to day-setup rows using shared market headlines."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.signals.geo_analyzer import GeoAnalyzer, GeoLayerResult
from stocvest.signals.sector_mapper import SectorMapper
from stocvest.utils.config import get_settings

_LOG = logging.getLogger(__name__)


def normalize_geo_scan_articles(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:24]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        desc = str(item.get("description") or "").strip()
        pub = item.get("published_utc") or item.get("published_at") or ""
        if not title and not desc:
            continue
        out.append({"title": title, "description": desc, "published_utc": str(pub)})
    return out


def _theme_tags_from_geo(geo: GeoLayerResult) -> list[str]:
    tags: list[str] = []
    for c in geo.chips or []:
        if not isinstance(c, str):
            continue
        if c.startswith("Themes:"):
            rest = c.split(":", 1)[1].strip()
            return [t.strip() for t in rest.split(",") if t.strip()][:6]
    for c in geo.chips or []:
        if isinstance(c, str) and c.startswith("Sector:"):
            rest = c.split(":", 1)[1].strip()
            if rest:
                tags.append(rest)
    if tags:
        return tags[:6]
    for e in geo.geo_active_events[:4]:
        et = str(e.get("event_type") or "").replace("_", " ").strip()
        if et and et != "?":
            tags.append(et)
    if tags:
        return tags[:6]
    for c in geo.chips or []:
        if isinstance(c, str) and c and not c.startswith("H/M/L"):
            tags.append(c)
    return tags[:6]


def geo_preview_dict(geo: GeoLayerResult) -> dict[str, Any]:
    raw_key = (geo.geo_impact_sector_key or "").strip()
    norm_key = raw_key.lower()
    if norm_key in ("", "default"):
        label = "Broad market"
        key_out = ""
    else:
        label = raw_key.replace("_", " ").title()
        key_out = raw_key
    band = (geo.geo_exposure_band or "").strip().lower()
    if band not in ("low", "moderate", "high"):
        band = "low"
    summary = geo.geo_exposure_summary
    if summary:
        s = summary.strip()
        summary = s[:200] + ("…" if len(s) > 200 else "")
    score = geo.geo_stock_exposure_score
    return {
        "impact_sector_key": key_out,
        "impact_sector_label": label,
        "exposure_band": band,
        "weighted_score": round(float(score), 3) if isinstance(score, (int, float)) and score is not None else None,
        "summary": summary or None,
        "theme_tags": _theme_tags_from_geo(geo),
    }


async def fetch_sector_buckets_for_symbols(symbols: list[str]) -> dict[str, str]:
    uniq = []
    seen: set[str] = set()
    for s in symbols:
        u = str(s or "").strip().upper()
        if not u or u in seen:
            continue
        seen.add(u)
        uniq.append(u)
    if not uniq:
        return {}
    settings = get_settings()
    cache = DynamoSectorCache(settings.dynamodb_sector_cache_table)
    out: dict[str, str] = {}
    try:
        async with PolygonClient(api_key=settings.polygon_api_key) as client:

            async def one(sym: str) -> tuple[str, str]:
                try:
                    _, _, bucket, _ = await SectorMapper.get_sector_etf(
                        sym,
                        client,
                        sector_cache if cache.enabled else None,
                        None,
                    )
                    return sym, bucket or "default"
                except (PolygonError, Exception) as exc:
                    _LOG.debug("sector bucket fetch failed symbol=%s err=%s", sym, exc)
                    return sym, "default"

            pairs = await asyncio.gather(*[one(s) for s in uniq])
            out = dict(pairs)
    except Exception as exc:
        _LOG.warning("sector bucket batch failed: %s", exc)
        for sym in uniq:
            out.setdefault(sym, "default")
    return out


async def _attach_geo_preview_async(rows: list[dict[str, Any]], payload: dict[str, Any], articles: list[dict[str, Any]]) -> None:
    symbols = [str(r.get("symbol") or "").strip().upper() for r in rows if r.get("symbol")]
    override_raw = payload.get("sector_buckets_by_symbol") or {}
    bucket_map: dict[str, str] = {}
    if isinstance(override_raw, dict):
        for k, v in override_raw.items():
            if not isinstance(k, str) or v is None:
                continue
            bucket_map[k.strip().upper()] = str(v).strip().lower() or "default"
    missing = [s for s in symbols if s not in bucket_map]
    if missing:
        fetched = await fetch_sector_buckets_for_symbols(missing)
        bucket_map.update(fetched)
    ga = GeoAnalyzer()
    lookback = 8
    lb_raw = payload.get("geo_lookback_hours")
    try:
        if lb_raw is not None:
            lookback = max(1, min(48, int(lb_raw)))
    except (TypeError, ValueError):
        pass
    for row in rows:
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym:
            continue
        bucket = bucket_map.get(sym, "default")
        geo = ga.analyze(articles, lookback_hours=lookback, sector_bucket=bucket if bucket != "default" else None)
        row["geo_preview"] = geo_preview_dict(geo)


def attach_geo_preview_to_intraday_rows(rows: list[dict[str, Any]], payload: dict[str, Any]) -> None:
    if not rows:
        return
    articles = normalize_geo_scan_articles(payload.get("geo_scan_articles"))
    try:
        asyncio.run(_attach_geo_preview_async(rows, payload, articles))
    except RuntimeError:
        # Nested loop (unlikely in Lambda) — skip rather than fail day setups
        _LOG.warning("geo preview skipped: asyncio.run not available in this context")

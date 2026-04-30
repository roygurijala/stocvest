"""Scanner API response cache: Redis (cluster-wide) + in-process fallback.

Keys: ``scan_kind`` (gaps|catalysts|intraday|briefing|schedule:...) + symbol fingerprint
+ payload hash + time bucket.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from stocvest.utils.config import get_settings
from stocvest.utils.redis_client import get_sync_redis

_MEMORY: dict[str, tuple[float, dict[str, Any]]] = {}
_MEMORY_TTL = 60


def _payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:24]


def _symbol_fingerprint(payload: dict[str, Any], scan_kind: str) -> str:
    if scan_kind == "gaps":
        snaps = payload.get("snapshots")
        if not isinstance(snaps, list):
            return "none"
        syms = sorted(
            str(s.get("symbol", "")).upper()
            for s in snaps
            if isinstance(s, dict) and s.get("symbol") is not None
        )
        return ",".join(syms) if syms else "none"
    if scan_kind == "catalysts":
        arts = payload.get("articles")
        if not isinstance(arts, list):
            return "none"
        keys = []
        for a in arts[:40]:
            if isinstance(a, dict) and a.get("article_id"):
                keys.append(str(a["article_id"]))
        return hashlib.sha256(",".join(sorted(keys)).encode()).hexdigest()[:16] if keys else "none"
    if scan_kind == "intraday":
        raw = payload.get("bars_by_symbol")
        if not isinstance(raw, dict):
            return "none"
        return ",".join(sorted(str(k).upper() for k in raw.keys()))
    if scan_kind == "briefing":
        d = str(payload.get("briefing_date", ""))
        return d
    if scan_kind.startswith("schedule:"):
        return scan_kind.split(":", 1)[-1]
    return "unknown"


def build_cache_key(scan_kind: str, payload: dict[str, Any]) -> str:
    settings = get_settings()
    bucket_sec = (
        int(settings.scanner_cache_bucket_seconds_intraday)
        if scan_kind == "intraday"
        else int(settings.scanner_cache_bucket_seconds)
    )
    bucket = int(time.time()) // max(1, bucket_sec)
    fp = _payload_hash(payload)
    sym = _symbol_fingerprint(payload, scan_kind)
    return f"stocvest:scanner:v1:{scan_kind}:{sym}:{fp}:{bucket}"


def cache_get(key: str) -> dict[str, Any] | None:
    r = get_sync_redis()
    if r is not None:
        try:
            raw = r.get(key)
            if raw:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    return parsed
        except Exception:
            pass
    row = _MEMORY.get(key)
    if row is None:
        return None
    exp, val = row
    if exp <= time.time():
        _MEMORY.pop(key, None)
        return None
    return json.loads(json.dumps(val))


def cache_set(key: str, response: dict[str, Any], *, ttl_seconds: int | None = None) -> dict[str, Any]:
    ttl = ttl_seconds if ttl_seconds is not None else _MEMORY_TTL
    r = get_sync_redis()
    if r is not None:
        try:
            r.setex(key, max(ttl, 30), json.dumps(response, separators=(",", ":"), default=str))
        except Exception:
            pass
    _MEMORY[key] = (time.time() + ttl, json.loads(json.dumps(response)))
    return response

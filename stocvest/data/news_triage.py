"""Fast pre-filter for news before Claude scoring (<5ms target, no I/O in hot path except cached Redis)."""

from __future__ import annotations

import json
import time
from typing import Any

from stocvest.data.models import NewsArticle
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

log = get_logger(__name__)

_HIGH_IMPACT_CATEGORIES = frozenset(
    {
        "earnings",
        "guidance",
        "fda",
        "mergers-acquisitions",
        "mergers-and-acquisitions",
        "m-a",
        "analyst-ratings",
        "analyst-rating",
        "insider-trades",
        "insider-trade",
        "offerings",
        "offering",
        "legal",
        "regulatory",
    }
)

_BULLISH = frozenset(
    {
        "beat",
        "beats",
        "exceeds",
        "raises",
        "upgrade",
        "upgraded",
        "acquires",
        "acquisition",
        "buyback",
        "approved",
        "fda approves",
        "record",
        "dividend",
        "partnership",
        "wins",
        "awarded",
    }
)

_BEARISH = frozenset(
    {
        "miss",
        "misses",
        "cuts",
        "lowered",
        "downgrade",
        "downgraded",
        "rejects",
        "fda rejects",
        "investigation",
        "lawsuit",
        "recall",
        "secondary offering",
        "dilution",
        "guidance cut",
        "layoffs",
        "bankruptcy",
        "fraud",
        "subpoena",
        "default",
    }
)


def _norm_title_words(title: str) -> str:
    return " ".join(title.lower().split())


def _title_hits_triggers(title_lower: str) -> bool:
    for phrase in _BEARISH:
        if phrase in title_lower:
            return True
    for phrase in _BULLISH:
        if phrase in title_lower:
            return True
    return False


def _category_high_signal(cats: set[str]) -> bool:
    if cats & _HIGH_IMPACT_CATEGORIES:
        return True
    for c in cats:
        for h in _HIGH_IMPACT_CATEGORIES:
            if h in c or c in h:
                return True
    return False


class NewsTriage:
    def __init__(self) -> None:
        self._active_cache: set[str] | None = None
        self._active_cache_at: float = 0.0
        self._dup_seen: dict[tuple[str, str], float] = {}
        self._dup_ttl_sec = 3600.0

    def get_active_tickers(self) -> set[str]:
        now = time.monotonic()
        if self._active_cache is not None and (now - self._active_cache_at) < 30.0:
            return self._active_cache
        settings = get_settings()
        key = settings.stocvest_active_signal_tickers_key.strip() or "stocvest:active_signal_tickers"
        out: set[str] = set()
        try:
            from stocvest.utils.redis_client import get_sync_redis

            r: Any = get_sync_redis()
            if r is not None:
                raw = r.get(key)
                if raw:
                    if isinstance(raw, str) and raw.strip().startswith("["):
                        data = json.loads(raw)
                        if isinstance(data, list):
                            out = {str(x).strip().upper() for x in data if str(x).strip()}
                    else:
                        out = {s.strip().upper() for s in str(raw).split(",") if s.strip()}
        except Exception as exc:
            log.debug("active_signal_tickers redis read failed: %s", exc)
        self._active_cache = out
        self._active_cache_at = now
        return out

    def _dup_key(self, article: NewsArticle) -> tuple[str, str]:
        company_key = (article.company_name or "").strip().lower()[:120]
        if not company_key:
            company_key = _norm_title_words(article.title or "")[:80]
        hour_bucket = article.published_at.astimezone().strftime("%Y%m%d%H")
        return company_key, hour_bucket

    def _dup_recent(self, key: tuple[str, str], now: float) -> bool:
        ts = self._dup_seen.get(key)
        if ts is None:
            return False
        return (now - ts) < self._dup_ttl_sec

    def _mark_dup(self, key: tuple[str, str], now: float) -> None:
        self._dup_seen[key] = now
        if len(self._dup_seen) > 3000:
            cutoff = now - self._dup_ttl_sec
            for k, ts in list(self._dup_seen.items())[:500]:
                if ts < cutoff:
                    self._dup_seen.pop(k, None)

    def should_score(self, article: NewsArticle) -> tuple[bool, str]:
        now = time.time()
        src = (article.source or "").strip().lower()
        title = (article.title or "").strip()
        dk = self._dup_key(article)
        title_lower = _norm_title_words(title)
        triggers = _title_hits_triggers(title_lower)
        tickers_u = {t.strip().upper() for t in article.tickers if t and str(t).strip()}
        active = self.get_active_tickers()
        cats = {c.strip().lower() for c in (article.categories or []) if c and str(c).strip()}

        if src == "sec_edgar":
            self._mark_dup(dk, now)
            return True, "sec_edgar_always"

        if len(title) < 10:
            return False, "title_too_short"

        if _category_high_signal(cats):
            self._mark_dup(dk, now)
            return True, "high_impact_category"

        if triggers:
            self._mark_dup(dk, now)
            return True, "trigger_keyword"

        if tickers_u & active:
            self._mark_dup(dk, now)
            return True, "active_signal_ticker"

        if self._dup_recent(dk, now):
            return False, "duplicate_company_hour"

        if src == "polygon" and not triggers and not (tickers_u & active):
            return False, "polygon_backup_filtered"

        self._mark_dup(dk, now)
        return True, "pass_default"

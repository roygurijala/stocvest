"""Ticker -> company-name variants using SEC company_tickers.json."""

from __future__ import annotations

import re
import threading
from typing import Any

import httpx

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_HEADERS = {"User-Agent": "STOCVEST/1.0 support@stocvest.app"}

CORP_SUFFIXES = (
    r"\bInc\.?$",
    r"\bCorp\.?$",
    r"\bLtd\.?$",
    r"\bLLC\.?$",
    r"\bL\.P\.?$",
    r"\bPlc\.?$",
    r"\bCo\.?$",
    r"\bGroup$",
    r"\bHoldings$",
    r"\bInternational$",
    r"\bTechnologies$",
    r"\bTechnology$",
    r"\bSolutions$",
    r"\bSystems$",
    r"\bEnterprises$",
)


def strip_suffix(name: str) -> str:
    result = str(name or "").strip()
    for pattern in CORP_SUFFIXES:
        result = re.sub(pattern, "", result, flags=re.IGNORECASE).strip()
    return result.strip(" .,&")


def build_name_variants(official_name: str) -> list[str]:
    variants: set[str] = set()
    original = str(official_name or "").strip()
    if not original:
        return []
    variants.add(original)
    variants.add(original.rstrip(".,"))

    short = strip_suffix(original)
    if short:
        variants.add(short)

    words = short.split() if short else []
    if words and len(words[0]) > 4:
        variants.add(words[0])

    if " & " in short:
        for part in short.split(" & "):
            p = part.strip()
            if len(p) > 3:
                variants.add(p)

    if "," in short:
        head = short.split(",", 1)[0].strip()
        if head:
            variants.add(head)

    out = [v.strip() for v in variants if v and len(v.strip()) > 2]
    out.sort(key=lambda x: (-len(x), x.lower()))
    return out


class TickerNameResolver:
    """Cold-start cached SEC ticker map with symbol-only fallback."""

    _memory_cache: dict[str, list[str]] = {}
    _sec_loaded = False
    _lock = threading.Lock()

    def get_name_variants(self, symbol: str) -> list[str]:
        sym = str(symbol or "").strip().upper()
        if not sym:
            return []
        if sym in self.__class__._memory_cache:
            return self.__class__._memory_cache[sym]
        if not self.__class__._sec_loaded:
            self._load_sec_tickers()
        return self.__class__._memory_cache.get(sym, [sym])

    def _load_sec_tickers(self) -> None:
        with self.__class__._lock:
            if self.__class__._sec_loaded:
                return
            loaded = 0
            try:
                resp = httpx.get(SEC_TICKERS_URL, headers=SEC_HEADERS, timeout=10.0)
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict):
                    for entry in data.values():
                        if not isinstance(entry, dict):
                            continue
                        ticker = str(entry.get("ticker") or "").strip().upper()
                        title = str(entry.get("title") or "").strip()
                        if not ticker:
                            continue
                        variants = build_name_variants(title) if title else []
                        self.__class__._memory_cache[ticker] = variants or [ticker]
                        loaded += 1
                _LOG.info("sec_tickers_loaded count=%d", loaded)
            except Exception as exc:
                _LOG.warning("sec_tickers_load_failed error=%s fallback=symbol_only", type(exc).__name__)
            finally:
                self.__class__._sec_loaded = True

    def article_matches_ticker(self, article_title: str, article_tickers: list[str], symbol: str) -> bool:
        sym = str(symbol or "").strip().upper()
        if not sym:
            return False
        tagged = {str(t or "").strip().upper() for t in (article_tickers or [])}
        if sym in tagged:
            return True
        title_lower = str(article_title or "").lower()
        for variant in self.get_name_variants(sym):
            if variant.lower() in title_lower:
                return True
        return False


_resolver_instance: TickerNameResolver | None = None


def get_resolver() -> TickerNameResolver:
    global _resolver_instance
    if _resolver_instance is None:
        _resolver_instance = TickerNameResolver()
    return _resolver_instance


def article_matches_ticker(title: str, article_tickers: list[str], symbol: str) -> bool:
    return get_resolver().article_matches_ticker(title, article_tickers, symbol)


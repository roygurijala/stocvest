"""
Symbol resolution for the STOCVEST Assistant and watchlist actions.

Wraps Polygon's ``/v3/reference/tickers/{symbol}`` reference lookup (via the
24h-cached :func:`get_ticker_reference`) to answer two questions in one call:

1.  *Is this a real, tradable ticker?*  — used to validate a symbol **before**
    it is written to a user's watchlist, so typos never silently land there.
2.  *What is the company name?* — used to display ``AAPL (Apple Inc.)`` next to
    the bare ticker across the app.

Validation policy
-----------------
We only **reject** a symbol when Polygon *definitively* says it does not exist
(HTTP 404 / empty reference) or that it is delisted (``active == False``). For
any transient failure (rate-limit, 5xx, timeout, missing API key) we *fail
open*: the add is allowed without a resolved name, so a Polygon hiccup never
blocks a legitimate ticker. The shape check still rejects obvious non-tickers
without any network call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.data.ticker_reference import parse_polygon_ticker_details
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

# Tickers we accept for watchlist/symbol entry: 1–6 chars, letters with an
# optional class suffix (BRK.B). Anything else is rejected before a network call.
_SYMBOL_SHAPE = re.compile(r"^[A-Z]{1,6}(?:\.[A-Z]{1,2})?$")

# Negative results (definitively-not-found) are cached briefly so repeated typos
# don't re-hit Polygon, but short enough that a brand-new listing resolves soon.
_NEGATIVE_CACHE_TTL_SEC = 1_800
_NEGATIVE_CACHE_KEY = "stocvest:symresolve:miss:v1:{sym}"


@dataclass(frozen=True)
class SymbolResolution:
    """Outcome of resolving a raw symbol against Polygon reference data."""

    symbol: str
    name: str | None
    #: True when the symbol may be added (confirmed-active, or unverifiable → fail-open).
    valid: bool
    #: True when Polygon positively confirmed the ticker exists.
    found: bool
    #: Polygon's ``active`` flag (None when unknown / unverified).
    active: bool | None
    #: True when we actually reached Polygon (vs. failed open without a check).
    verified: bool
    #: Short user-facing reason when ``valid is False`` (else None).
    reason: str | None = None

    @property
    def display_label(self) -> str:
        """``AAPL (Apple Inc.)`` when a name is known, else just the symbol."""
        if self.name:
            return f"{self.symbol} ({self.name})"
        return self.symbol


def _normalize(symbol: str) -> str:
    return str(symbol or "").strip().upper()


def _read_negative_cache(sym: str) -> bool:
    r = get_sync_redis()
    if r is None:
        return False
    try:
        return bool(r.get(_NEGATIVE_CACHE_KEY.format(sym=sym)))
    except Exception:  # noqa: BLE001 — cache is best-effort
        return False


def _write_negative_cache(sym: str) -> None:
    r = get_sync_redis()
    if r is None:
        return
    try:
        r.set(_NEGATIVE_CACHE_KEY.format(sym=sym), "1", ex=_NEGATIVE_CACHE_TTL_SEC)
    except Exception:  # noqa: BLE001
        pass


def _not_found(sym: str, reason: str) -> SymbolResolution:
    return SymbolResolution(
        symbol=sym,
        name=None,
        valid=False,
        found=False,
        active=None,
        verified=True,
        reason=reason,
    )


def _fail_open(sym: str) -> SymbolResolution:
    """Allow the add without verification (transient upstream failure)."""
    return SymbolResolution(
        symbol=sym,
        name=None,
        valid=True,
        found=False,
        active=None,
        verified=False,
        reason=None,
    )


def _is_definitive_miss(exc: Exception) -> bool:
    """True when a PolygonError means the ticker does not exist (vs. transient)."""
    msg = str(exc)
    return "Polygon 404" in msg or "NOT_FOUND" in msg.upper() or "not found" in msg.lower()


def _normalize_name(value: str | None) -> str:
    """Lowercase a company name and strip punctuation for fuzzy comparison."""
    return re.sub(r"[^a-z0-9 ]", "", str(value or "").lower()).strip()


def _best_company_match(query_lower: str, rows: list[dict[str, str]]) -> str | None:
    """Pick the ticker whose company name best matches *query_lower*.

    Only returns a ticker when there is a confident name/ticker match, so a
    fuzzy reference search never hands back an unrelated symbol. Match order:
    exact ticker → company name starts with the query → first name-word starts
    with the query (e.g. "marvel" → "Marvell Technology").
    """
    if not rows:
        return None
    q_compact = query_lower.replace(" ", "")
    for row in rows:
        if str(row.get("ticker") or "").lower() == q_compact:
            return str(row["ticker"]).upper()
    for row in rows:
        name = _normalize_name(row.get("name"))
        if name and name.startswith(query_lower):
            return str(row.get("ticker") or "").upper() or None
    for row in rows:
        name = _normalize_name(row.get("name"))
        first_word = name.split(" ", 1)[0] if name else ""
        if first_word and first_word.startswith(query_lower):
            return str(row.get("ticker") or "").upper() or None
    return None


async def resolve_company_to_symbol(
    query: str,
    *,
    client: PolygonClient | None = None,
) -> str | None:
    """Resolve a company-name *query* (e.g. "marvell") to its ticker, or None.

    Used as a fallback when the assistant detects no ticker token but the user
    asks about a named company. Returns a ticker only on a confident name/ticker
    match (see :func:`_best_company_match`); fails closed (None) on any upstream
    error so a bad search never triggers a wrong-symbol fetch.
    """
    q = (query or "").strip()
    if len(q) < 3:
        return None
    q_lower = _normalize_name(q)
    if not q_lower:
        return None

    async def _search(active_client: PolygonClient) -> str | None:
        try:
            rows = await active_client.search_reference_tickers(q, limit=10)
        except Exception as exc:  # noqa: BLE001 — best-effort resolution
            _LOG.warning("resolve_company_to_symbol search failed for %r: %s", q, str(exc)[:160])
            return None
        return _best_company_match(q_lower, rows)

    if client is not None:
        return await _search(client)

    api_key = get_settings().polygon_api_key
    if not api_key:
        return None
    try:
        async with PolygonClient(api_key=api_key) as owned:
            return await _search(owned)
    except Exception as exc:  # noqa: BLE001 — client construction / session failure
        _LOG.warning("resolve_company_to_symbol client error for %r: %s", q, str(exc)[:160])
        return None


async def resolve_symbol(
    symbol: str,
    *,
    client: PolygonClient | None = None,
) -> SymbolResolution:
    """Resolve *symbol* to a validity verdict and company name.

    Pass an open *client* to reuse an existing Polygon session; otherwise a
    short-lived client is created with the configured API key.
    """
    sym = _normalize(symbol)
    if not sym:
        return _not_found(sym, "I couldn't read a stock symbol to look up.")
    if not _SYMBOL_SHAPE.match(sym):
        return _not_found(
            sym,
            f'"{sym}" doesn\'t look like a stock ticker.',
        )

    if _read_negative_cache(sym):
        return _not_found(
            sym,
            f'I couldn\'t find a tradable stock with the ticker "{sym}".',
        )

    async def _lookup(active_client: PolygonClient) -> SymbolResolution:
        try:
            detail = await active_client.get_ticker_details(sym)
        except PolygonError as exc:
            if _is_definitive_miss(exc):
                _write_negative_cache(sym)
                return _not_found(
                    sym,
                    f'I couldn\'t find a tradable stock with the ticker "{sym}".',
                )
            _LOG.warning("resolve_symbol transient failure for %s: %s", sym, str(exc)[:160])
            return _fail_open(sym)
        except Exception as exc:  # noqa: BLE001 — never block an add on an unexpected error
            _LOG.warning("resolve_symbol unexpected error for %s: %s", sym, str(exc)[:160])
            return _fail_open(sym)

        ref = parse_polygon_ticker_details(detail if isinstance(detail, dict) else None, symbol=sym)
        if ref is None:
            _write_negative_cache(sym)
            return _not_found(
                sym,
                f'I couldn\'t find a tradable stock with the ticker "{sym}".',
            )
        if ref.active is False:
            return SymbolResolution(
                symbol=sym,
                name=ref.name,
                valid=False,
                found=True,
                active=False,
                verified=True,
                reason=f"{ref.name or sym} appears to be delisted, so I can't add it.",
            )
        return SymbolResolution(
            symbol=sym,
            name=ref.name,
            valid=True,
            found=True,
            active=ref.active,
            verified=True,
            reason=None,
        )

    if client is not None:
        return await _lookup(client)

    api_key = get_settings().polygon_api_key
    if not api_key:
        # No credentials available — don't block the user; just skip verification.
        return _fail_open(sym)

    try:
        async with PolygonClient(api_key=api_key) as owned:
            return await _lookup(owned)
    except Exception as exc:  # noqa: BLE001 — client construction / session failure
        _LOG.warning("resolve_symbol client error for %s: %s", sym, str(exc)[:160])
        return _fail_open(sym)

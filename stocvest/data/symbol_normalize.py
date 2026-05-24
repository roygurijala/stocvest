"""Symbol normalization between user-facing form and Polygon wire form.

Background
==========
Polygon's REST endpoints are picky about how class-share suffixes are
spelled. The aggregates (``/v2/aggs/...``) and the snapshot
(``/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}``) endpoints
return ``404 NotFound`` for ``BRK-B`` and only respond to ``BRK.B``.

Live probe on 2026-05-13::

    GET /v2/aggs/ticker/BRK-B/range/1/day/...  →  results=[]   (silent, "no bars")
    GET /v2/aggs/ticker/BRK.B/range/1/day/...  →  results=[…] (10 bars)
    GET /v2/snapshot/.../BRK-B                 →  404 NotFound
    GET /v2/snapshot/.../BRK.B                 →  200 OK

Symptom in production
---------------------
A user typing ``BRK-B`` in the search box ended up with:

* ``daily bars = 0``
* ``technical layer = unavailable``  (needs ≥60 daily bars)
* ``sector layer = unavailable``     (cascades from snapshot 404)
* composite collapses to ``incomplete`` / ``neutral`` even though
  Berkshire is a perfectly healthy, normal liquidity name.

This module centralises the mapping so every Polygon call goes out in
the form Polygon expects, while the rest of the engine can keep using
whatever the user typed. Only the *wire* form changes — the response
payload still surfaces whatever symbol the engine was invoked with.

Rule
====
A trailing single letter joined by a dash is the class-share marker
that Polygon spells with a dot. Everything else passes through
unchanged so we don't accidentally break unusual tickers (preferred
shares, index symbols like ``I:VIX``, etc.).

Examples::

    BRK-B   → BRK.B
    BRK-A   → BRK.A
    RDS-A   → RDS.A
    BF-B    → BF.B
    AAPL    → AAPL
    BRK.B   → BRK.B           (already canonical)
    I:VIX   → I:VIX           (index ticker, untouched)
    JPM-PRD → JPM-PRD         (preferred, multi-letter suffix, untouched)
    ""      → ""
"""

from __future__ import annotations

import re

__all__ = ["TICKER_SEARCH_MIN_QUERY_LEN", "to_polygon_symbol"]

# Include single-letter US tickers (F, T, C, V, …) in symbol pickers.
TICKER_SEARCH_MIN_QUERY_LEN = 1


# A "class-share dash" is one or more letters, a single ``-``, and exactly
# one trailing letter. We deliberately keep this conservative — any other
# dash pattern (e.g. preferred shares with multi-letter suffixes) is left
# alone because Polygon's accepted spelling varies case by case.
_CLASS_SHARE_DASH = re.compile(r"^([A-Z]+)-([A-Z])$")


def to_polygon_symbol(symbol: str) -> str:
    """Return the symbol in the form Polygon's REST endpoints accept.

    Idempotent: passing an already-normalized symbol returns it unchanged.
    Safe to call on empty strings.
    """
    if not symbol:
        return symbol
    s = symbol.strip().upper()
    m = _CLASS_SHARE_DASH.match(s)
    if m is None:
        return s
    return f"{m.group(1)}.{m.group(2)}"

#!/usr/bin/env python3
"""Verify Polygon/Massive ETF Global constituents access for the configured API key.

Usage:
  python scripts/verify_etf_global_access.py
  python scripts/verify_etf_global_access.py --etf XLE --limit 8

Exit 0 when top holdings are returned; exit 1 when the add-on is unavailable or the key is missing.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.utils.config import get_settings


async def _run(etf: str, limit: int) -> int:
    settings = get_settings()
    api_key = (settings.polygon_api_key or "").strip()
    if not api_key:
        print("POLYGON_API_KEY is not configured.")
        return 1

    try:
        async with PolygonClient(api_key=api_key) as client:
            rows = await client.get_etf_constituents(etf, limit=limit)
    except PolygonError as exc:
        print(f"ETF Global request failed: {exc}")
        print(
            "Enable the ETF Global Constituents add-on on your Polygon/Massive plan, "
            "then retry: https://massive.com/docs/rest/partners/etf-global/constituents"
        )
        return 1

    if not rows:
        print(f"No holdings returned for {etf}. ETF Global may not be enabled on this API key.")
        return 1

    as_of = next((row.effective_date for row in rows if row.effective_date), None)
    print(f"ETF Global OK — {etf} top {len(rows)} holdings" + (f" (as of {as_of})" if as_of else ""))
    for row in rows:
        weight_pct = f"{row.weight * 100:.2f}%" if row.weight is not None else "n/a"
        print(f"  #{row.rank or '?'} {row.symbol:<6} {weight_pct:>8}  {row.name or ''}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Polygon ETF Global constituents access.")
    parser.add_argument("--etf", default="XLE", help="Sector ETF symbol to probe (default: XLE)")
    parser.add_argument("--limit", type=int, default=8, help="Number of holdings to fetch (default: 8)")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args.etf.strip().upper(), max(1, min(args.limit, 20)))))


if __name__ == "__main__":
    main()

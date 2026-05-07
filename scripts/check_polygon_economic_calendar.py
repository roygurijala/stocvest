#!/usr/bin/env python3
"""
One-time verification: does Polygon's economics partner calendar meet our requirements?

Run: python scripts/check_polygon_economic_calendar.py

Checks:
  1. Future events available (not just historical)
  2. Fed / FOMC-style events identifiable from names
  3. Date + optional time fields present
  4. Importance / impact field present

Requires POLYGON_API_KEY in environment (via .env or Settings).
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import date, timedelta

import httpx

from stocvest.utils.config import get_settings


BASE = "https://api.polygon.io"


async def check() -> None:
    settings = get_settings()
    key = settings.polygon_api_key
    today = date.today()
    future_end = today + timedelta(days=30)

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Primary: Benzinga economics on Polygon (same as polygon_client.get_economic_calendar_range)
        econ_url = f"{BASE}/benzinga/v1/economics"
        resp = await client.get(
            econ_url,
            params={
                "apiKey": key,
                "date.gte": today.isoformat(),
                "date.lte": future_end.isoformat(),
                "limit": "50",
                "sort": "date.asc",
            },
        )
        print("\n=== Polygon Benzinga economics (future window) ===")
        print(f"URL: {econ_url}")
        print(f"Status: {resp.status_code}")
        if resp.status_code != 200:
            print(resp.text[:800])
            return
        data = resp.json()
        results = data.get("results") or []
        print(f"Result count: {len(results)}")
        if results:
            sample = results[0]
            print("Sample keys:", sorted(sample.keys()))
            print(json.dumps(sample, indent=2)[:1200])

        fed_like = [
            r
            for r in results
            if isinstance(r, dict)
            and any(
                k in str(r.get("event_name") or r.get("title") or "").lower()
                for k in ("fomc", "fed", "federal reserve", "interest rate decision")
            )
        ]
        print(f"\nFed/FOMC-like rows in sample: {len(fed_like)}")
        for r in fed_like[:5]:
            print("-", r.get("event_name") or r.get("title"), "|", r.get("date"), "| impact:", r.get("importance") or r.get("impact"))

    print(
        "\n--- Findings (see also stocvest/data/fred_client.py module doc) ---\n"
        "Polygon /benzinga/v1/economics provides dated rows with event_name, date, time, importance.\n"
        "Coverage depends on API tier; Fed tagging is by substring on event_name, not a dedicated enum.\n"
        "FRED release/dates + series observations remain the authoritative schedule/yield source when\n"
        "a FRED_API_KEY is configured; Polygon economics is merged as a convenience overlay in macro context.\n"
    )


def main() -> None:
    try:
        asyncio.run(check())
    except Exception as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

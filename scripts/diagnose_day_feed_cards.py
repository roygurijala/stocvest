#!/usr/bin/env python3
"""Diagnose Trading Room day feed cards vs live desk cache + funnel."""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


def _leader_state(leader: dict[str, Any]) -> str:
    if leader.get("execution_actionable") is True:
        return "actionable"
    decision = str(leader.get("decision_state") or "").strip().lower()
    if decision == "actionable":
        return "actionable"
    if decision == "monitor":
        return "near"
    if decision == "blocked":
        return "cooling"
    status = str(leader.get("composite_status") or leader.get("verdict") or "").strip().lower()
    if any(k in status for k in ("actionable", "qualified", "ready")):
        return "actionable"
    if any(k in status for k in ("cool", "faded", "expired")):
        return "cooling"
    if any(k in status for k in ("near", "forming", "watch")):
        return "near"
    ratio = leader.get("alignment_ratio")
    if isinstance(ratio, (int, float)):
        if ratio >= 0.8:
            return "actionable"
        if ratio >= 0.55:
            return "near"
        return "potential"
    return "potential"


def _simulate_feed_cards(
    day_desk: dict[str, Any] | None,
    *,
    day_trading_surfaces: bool = True,
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    if not day_trading_surfaces:
        return cards
    for leader in (day_desk or {}).get("discovery") or []:
        if not isinstance(leader, dict):
            continue
        sym = str(leader.get("symbol") or "").strip().upper()
        if not sym:
            continue
        cards.append(
            {
                "id": f"day:{sym}",
                "symbol": sym,
                "state": _leader_state(leader),
                "source": "desk",
                "rank_score": leader.get("rank_score"),
                "decision_state": leader.get("decision_state"),
                "alignment_ratio": leader.get("alignment_ratio"),
            }
        )
    return cards


def _cap_feed(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    caps = {"actionable": 10, "near": 8, "potential": 6, "cooling": 5}
    order = {"actionable": 0, "near": 1, "potential": 2, "cooling": 3}
    sorted_cards = sorted(
        cards,
        key=lambda c: (
            order.get(c["state"], 9),
            -(float(c.get("rank_score") or 0)),
            c["symbol"],
        ),
    )
    seen = {k: 0 for k in caps}
    out: list[dict[str, Any]] = []
    for card in sorted_cards:
        st = card["state"]
        if seen.get(st, 0) >= caps.get(st, 0):
            continue
        seen[st] += 1
        out.append(card)
    return out


async def _run() -> int:
    from stocvest.api.services.opportunity_desk.batch import (
        _composite_day,
        _default_batch_config_from_settings,
        opportunity_desk_redis_key,
    )
    from stocvest.api.services.opportunity_desk.discovery_row import discovery_row_from_mover
    from stocvest.api.services.opportunity_desk.funnel import run_snapshot_funnel
    from stocvest.api.services.opportunity_desk.snapshot_load import load_us_equity_snapshots_for_funnel
    from stocvest.data.dashboard_cache import read_dashboard_cache, upstash_configured

    now_et = datetime.now(ET)
    print(f"=== Day feed diagnostic @ {now_et.strftime('%Y-%m-%d %H:%M %Z')} ===\n")

    if not upstash_configured():
        print("WARN: Upstash not configured locally — skipping production desk cache read.")
    else:
        for mode in ("day", "swing"):
            key = opportunity_desk_redis_key(mode)  # type: ignore[arg-type]
            envelope = read_dashboard_cache(key)
            if not envelope:
                print(f"[{mode}] desk cache: MISS")
                continue
            data = envelope.get("data") if isinstance(envelope.get("data"), dict) else {}
            discovery = data.get("discovery") or []
            movers = data.get("movers_radar") or []
            print(f"[{mode}] desk cache: HIT")
            print(f"  market_date     : {envelope.get('market_date')}")
            print(f"  computed_at     : {envelope.get('computed_at')}")
            print(f"  state_version   : {envelope.get('state_version')}")
            print(f"  discovery count : {len(discovery)}")
            print(f"  movers_radar    : {len(movers)}")
            if discovery:
                print("  discovery leaders:")
                for row in discovery[:12]:
                    if not isinstance(row, dict):
                        continue
                    sym = row.get("symbol")
                    st = _leader_state(row)
                    print(
                        f"    {sym:6} state={st:11} decision={row.get('decision_state')} "
                        f"align={row.get('alignment_ratio')} rank={row.get('rank_score')}"
                    )

        day_env = read_dashboard_cache(opportunity_desk_redis_key("day"))  # type: ignore[arg-type]
        day_data = (day_env or {}).get("data") if isinstance((day_env or {}).get("data"), dict) else None
        raw_cards = _simulate_feed_cards(day_data, day_trading_surfaces=True)
        capped = _cap_feed(raw_cards)
        print("\n[feed-model from cache] dayTradingSurfaces=true, desk-only")
        print(f"  raw day cards   : {len(raw_cards)}")
        print(f"  after rank/cap  : {len(capped)}")
        if capped:
            print("  would show:")
            for c in capped:
                print(f"    {c['symbol']:6} {c['state']}")
        else:
            print("  would show: (empty — FeedLaneSection hidden)")

    print("\n--- Live Polygon funnel (right now) ---")
    cfg = _default_batch_config_from_settings()
    snapshots, source = await load_us_equity_snapshots_for_funnel()
    print(f"snapshot source : {source}")
    print(f"snapshot count  : {len(snapshots)}")
    if not snapshots:
        print("Cannot run funnel — no snapshots.")
        return 1

    funnel = run_snapshot_funnel(snapshots, cfg.funnel)
    print(f"eligible={funnel.eligible_symbol_count} movers={len(funnel.movers)}")
    print("top movers:")
    for m in funnel.movers[:8]:
        print(f"  {m.symbol:6} gap={m.gap_percent:+.1f}% rank={m.rank_score:.2f}")

    padded = [
        discovery_row_from_mover(m, mode="day", composite=None)
        for m in funnel.movers[: cfg.funnel.discovery_display_limit]
    ]
    padded_cards = _cap_feed(
        [
            {
                "symbol": r["symbol"],
                "state": _leader_state(r),
                "rank_score": r.get("rank_score"),
            }
            for r in padded
        ]
    )
    print(f"\n[funnel-only day desk] {len(padded)} discovery rows -> {len(padded_cards)} feed cards")
    for c in padded_cards:
        print(f"  {c['symbol']:6} {c['state']}")

    print("\n--- Day composite on top 8 movers (matches desk batch) ---")
    discovery: list[dict[str, Any]] = []
    for m in funnel.movers[: cfg.composite_limit_day]:
        composite = await _composite_day(m.symbol)
        row = discovery_row_from_mover(m, mode="day", composite=composite)
        discovery.append(row)
        print(
            f"  {m.symbol:6} gap={m.gap_percent:+.1f}% "
            f"feed={_leader_state(row):11} decision={row.get('decision_state')} align={row.get('alignment_ratio')}"
        )

    for m in funnel.movers:
        if len(discovery) >= cfg.funnel.discovery_display_limit:
            break
        if any(r["symbol"] == m.symbol for r in discovery):
            continue
        discovery.append(discovery_row_from_mover(m, mode="day", composite=None))

    discovery = discovery[: cfg.funnel.discovery_display_limit]
    feed_cards = _cap_feed(
        [
            {
                "symbol": r["symbol"],
                "state": _leader_state(r),
                "rank_score": r.get("rank_score"),
            }
            for r in discovery
        ]
    )
    print(f"\n[simulated day desk batch] {len(discovery)} discovery -> {len(feed_cards)} left-pane cards")
    for c in feed_cards:
        print(f"  SHOW {c['symbol']:6} {c['state']}")
    actionable = [c for c in feed_cards if c["state"] == "actionable"]
    print(f"actionable-only count: {len(actionable)}")
    if not feed_cards:
        print("VERDICT: No day cards expected from live data right now.")
    elif not actionable:
        print("VERDICT: Market has movers but none are actionable — potential/near/cooling cards expected.")
    else:
        print("VERDICT: Actionable day cards exist — left pane should not be empty if desk cache is fresh.")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run()))

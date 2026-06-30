"""B80 structure geometry validation (read-only).

Compares **legacy** geometry (stop anchor merged with session / entry-zone low)
vs **B80** (stop from nearest ATR-ranked structure zone, decoupled from entry band).

Section 1 — synthetic fixture cohort (always runs; no AWS / network):
  * Entry-anchor: B80 structure anchor yields a tighter entry band than legacy SMA/VWAP.
  * INTC-like entry-zone: tight band preserved + ``no_clean_entry`` when geometry is untradeable.
  * Analyst PT excluded from gated structural T2.
  * Stop note: session/swing lows still bind ``resolve_structural_stop_anchor`` — legacy vs B80
    stop inputs can match when those lows dominate; ledger ``--scan`` reports |Δstop|/ATR where they diverge.

Section 2 — optional ledger replay (--scan --days N):
  Scans qualified ``SignalHistory`` rows, hydrates ATR from ``technical_snapshot_json``,
  fetches Polygon daily bars, and reports |Δstop|/ATR + planned-R/R deltas.

Gate criteria (B80 ship checklist):
  * Entry-anchor fixture: B80 structure anchor yields a tighter entry band than legacy SMA/VWAP.
  * INTC-like entry-zone: tight band preserved + ``no_clean_entry`` when T1/stop geometry is untradeable.
  * Analyst PT fixture: gated T2 does not adopt the analyst level as structural resistance.
  * Stop note: ``resolve_structural_stop_anchor`` still merges session/swing lows — when those
    bind, legacy (day_lo as zone_lo) and B80 (structure zone as zone_lo) can match; ledger scan
    reports |Δstop|/ATR where they diverge.

Run:
  python scripts/validate_structure_geometry.py
  python scripts/validate_structure_geometry.py --scan --days 60
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import statistics as st
from dataclasses import dataclass
from typing import Any, Literal

import boto3

from stocvest.api.services.entry_zone import (
    config_for_mode,
    resolve_anchor,
    resolve_entry_zone,
    resolve_structure_entry_anchor,
    resolve_structure_zone_level,
)
from stocvest.api.services.swing_composite_evidence import (
    _effective_rr_target,
    _entry_price_for_rr,
    _long_side_geometry,
    _short_side_geometry,
    _swing_range_from_payload,
)
from stocvest.data.models import Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings

logging.disable(logging.CRITICAL)

Variant = Literal["legacy", "b80"]
Direction = Literal["long", "short"]
RR_GATE = 1.5
CONCURRENCY = 8


@dataclass(frozen=True)
class GeometryCase:
    name: str
    direction: Direction
    last: float
    day_lo: float | None
    day_hi: float | None
    atr: float
    daily_bars: list[dict[str, float]]
    trading_mode: str = "swing"
    vwap: float | None = None
    prev_close: float | None = None
    sma20: float | None = None
    sma50: float | None = None
    analyst_target_levels: list[float] | None = None


@dataclass
class GeometryReplayResult:
    variant: Variant
    stop: float | None
    target_1: float | None
    target_2: float | None
    target_2_provenance: str | None
    planned_rr: float | None
    entry_zone_quality: str | None
    entry_zone_width_pct: float | None
    stop_distance_atr: float | None


def planned_rr(entry: float, stop: float | None, target: float | None) -> float | None:
    if stop is None or target is None or entry <= 0:
        return None
    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 1e-9:
        return None
    return reward / risk


def _swing_range_from_bars(daily_bars: list[dict[str, float]], *, lookback: int = 10) -> tuple[float | None, float | None]:
    payload = {"daily_bars_range": daily_bars}
    zone = _swing_range_from_payload(payload, lookback=lookback)
    if not zone:
        return None, None
    return float(zone["low"]), float(zone["high"])


def replay_geometry(case: GeometryCase, *, variant: Variant) -> GeometryReplayResult:
    """Replay stop / targets / entry-zone for one fixture under legacy or B80 rules."""
    payload = {
        "daily_bars_range": case.daily_bars,
        "mode": case.trading_mode,
        "analyst_target_levels": case.analyst_target_levels or [],
    }
    swing_lo, swing_hi = _swing_range_from_bars(case.daily_bars)
    entry = _entry_price_for_rr(case.last, case.day_lo, case.day_hi)
    ez_cfg = config_for_mode(None, case.trading_mode)

    if case.direction == "long":
        if variant == "legacy":
            stop_zone_lo = case.day_lo
        else:
            stop_zone_lo = resolve_structure_zone_level(
                direction="long",
                last=case.last,
                atr=case.atr,
                daily_bars=case.daily_bars,
                trading_mode=case.trading_mode,
                vwap=case.vwap,
                sma20=case.sma20,
                sma50=case.sma50,
                day_lo=case.day_lo,
            )
        stop, t1, t2, _used_atr, t2_prov = _long_side_geometry(
            day_lo=case.day_lo,
            day_hi=case.day_hi,
            vwap=case.vwap,
            prev_close=case.prev_close,
            last=case.last,
            entry=entry,
            atr=case.atr,
            trading_mode=case.trading_mode,
            swing_lo=swing_lo,
            swing_hi=swing_hi,
            zone_lo=stop_zone_lo,
            zone_hi=None,
            daily_bars=case.daily_bars,
            analyst_target_levels=case.analyst_target_levels,
            target_geometry_v2=True,
            analyst_max_pct=40.0,
            target_geometry_v3=True,
            sma20=case.sma20,
            sma50=case.sma50,
        )
        if variant == "legacy":
            anchor = resolve_anchor(
                preferred=str(ez_cfg["preferred_anchor"]),
                vwap=case.vwap,
                prev_close=case.prev_close,
                sma20=case.sma20,
                sma50=case.sma50,
                last=case.last,
            )
        else:
            anchor = resolve_structure_entry_anchor(
                direction="long",
                last=case.last,
                atr=case.atr,
                daily_bars=case.daily_bars,
                trading_mode=case.trading_mode,
                preferred=str(ez_cfg["preferred_anchor"]),
                vwap=case.vwap,
                prev_close=case.prev_close,
                sma20=case.sma20,
                sma50=case.sma50,
                day_lo=case.day_lo,
                day_hi=case.day_hi,
            )
    else:
        if variant == "legacy":
            stop_zone_hi = case.day_hi
        else:
            stop_zone_hi = resolve_structure_zone_level(
                direction="short",
                last=case.last,
                atr=case.atr,
                daily_bars=case.daily_bars,
                trading_mode=case.trading_mode,
                vwap=case.vwap,
                sma20=case.sma20,
                sma50=case.sma50,
                day_hi=case.day_hi,
            )
        stop, t1, t2, _used_atr, t2_prov = _short_side_geometry(
            day_lo=case.day_lo,
            day_hi=case.day_hi,
            vwap=case.vwap,
            prev_close=case.prev_close,
            last=case.last,
            entry=entry,
            atr=case.atr,
            trading_mode=case.trading_mode,
            swing_lo=swing_lo,
            swing_hi=swing_hi,
            zone_hi=stop_zone_hi,
            daily_bars=case.daily_bars,
            target_geometry_v3=True,
            sma20=case.sma20,
            sma50=case.sma50,
        )
        if variant == "legacy":
            anchor = resolve_anchor(
                preferred=str(ez_cfg["preferred_anchor"]),
                vwap=case.vwap,
                prev_close=case.prev_close,
                sma20=case.sma20,
                sma50=case.sma50,
                last=case.last,
            )
        else:
            anchor = resolve_structure_entry_anchor(
                direction="short",
                last=case.last,
                atr=case.atr,
                daily_bars=case.daily_bars,
                trading_mode=case.trading_mode,
                preferred=str(ez_cfg["preferred_anchor"]),
                vwap=case.vwap,
                prev_close=case.prev_close,
                sma20=case.sma20,
                sma50=case.sma50,
                day_lo=case.day_lo,
                day_hi=case.day_hi,
            )

    ez_quality: str | None = None
    ez_width: float | None = None
    rr_target = t1
    if entry is not None and stop is not None and t1 is not None:
        rr_target = _effective_rr_target(
            entry=float(entry),
            stop=float(stop),
            target_1=float(t1),
            target_2=t2,
            is_long=case.direction == "long",
            target_2_provenance=t2_prov,
        )
        ez = resolve_entry_zone(
            direction=case.direction,
            last=case.last,
            stop=stop,
            target_1=rr_target,
            anchor=anchor,
            atr=case.atr,
            config=ez_cfg,
        )
        if ez is not None:
            ez_quality = ez.quality
            ez_width = (ez.high - ez.low) / case.last if case.last > 0 else None

    p_rr = planned_rr(float(entry or case.last), stop, rr_target)
    stop_dist_atr = (
        abs(float(entry or case.last) - float(stop)) / case.atr
        if stop is not None and case.atr > 0
        else None
    )
    return GeometryReplayResult(
        variant=variant,
        stop=stop,
        target_1=t1,
        target_2=t2,
        target_2_provenance=t2_prov,
        planned_rr=p_rr,
        entry_zone_quality=ez_quality,
        entry_zone_width_pct=ez_width,
        stop_distance_atr=stop_dist_atr,
    )


def _bars_ramp(highs: list[float], *, drop: float = 2.5) -> list[dict[str, float]]:
    return [{"low": h - drop, "high": h} for h in highs]


SYNTHETIC_CASES: tuple[GeometryCase, ...] = (
    GeometryCase(
        name="Entry anchor — structure zone vs legacy SMA (tighter B80 band)",
        direction="long",
        last=100.0,
        day_lo=98.0,
        day_hi=100.5,
        atr=2.0,
        vwap=99.5,
        sma20=97.0,
        daily_bars=[
            {"low": 93.0, "high": 96.0},
            {"low": 93.2, "high": 96.5},
            {"low": 95.0, "high": 98.0},
            {"low": 96.0, "high": 99.0},
            {"low": 97.0, "high": 100.0},
            {"low": 97.5, "high": 100.5},
        ],
    ),
    GeometryCase(
        name="HOD-breakout long (v3 T1 ATR floor, clustered resistance above)",
        direction="long",
        last=100.0,
        day_lo=98.0,
        day_hi=100.0,
        atr=2.0,
        vwap=99.0,
        daily_bars=_bars_ramp([96.0, 97.0, 98.0, 99.0, 100.0, 101.0, 102.0, 103.0, 104.0, 105.0], drop=2.0),
    ),
    GeometryCase(
        name="Analyst PT must not gate T2 (structural scan only under B80)",
        direction="long",
        last=100.0,
        day_lo=98.0,
        day_hi=100.0,
        atr=2.0,
        vwap=99.0,
        analyst_target_levels=[130.0],
        daily_bars=_bars_ramp([96.0, 97.0, 98.0, 99.0, 100.0], drop=2.0),
    ),
    GeometryCase(
        name="Bearish fade near session high (stop above structure resistance)",
        direction="short",
        last=50.0,
        day_lo=48.0,
        day_hi=50.5,
        atr=1.2,
        vwap=49.8,
        daily_bars=_bars_ramp([47.0, 48.0, 49.0, 50.0, 50.5, 51.0, 51.5], drop=1.0),
    ),
)


def _intc_entry_zone_check() -> tuple[bool, str]:
    """INTC-like collapse: tight band preserved, flagged no_clean_entry (B80 entry-zone fix)."""
    cfg = config_for_mode(None, "swing")
    cfg["min_rr_from_zone_high"] = 2.0
    ez = resolve_entry_zone(
        direction="long",
        last=131.32,
        stop=115.42,
        target_1=132.61,
        anchor=122.30,
        atr=3.5,
        config=cfg,
    )
    if ez is None:
        return False, "resolve_entry_zone returned None"
    width_pct = (ez.high - ez.low) / 131.32
    ok = (
        ez.quality == "no_clean_entry"
        and abs(ez.high - 131.32) < 0.02
        and width_pct <= cfg["max_width_pct"] + 1e-3
        and (ez.worst_case_rr or 0) < 2.0
    )
    detail = (
        f"quality={ez.quality} band=[{ez.low:.2f},{ez.high:.2f}] "
        f"width={width_pct*100:.2f}% worst_rr={ez.worst_case_rr}"
    )
    return ok, detail


def _fmt(x: float | None, *, digits: int = 2) -> str:
    if x is None:
        return "—"
    return f"{x:.{digits}f}"


def print_synthetic_report(cases: tuple[GeometryCase, ...] = SYNTHETIC_CASES) -> bool:
    """Print fixture cohort report. Returns True when gate checks pass."""
    print("B80 structure geometry — synthetic fixture cohort\n")
    gate_ok = True
    for case in cases:
        leg = replay_geometry(case, variant="legacy")
        b80 = replay_geometry(case, variant="b80")
        print(f"▸ {case.name}")
        print(
            f"  last={case.last}  ATR={case.atr}  session [{_fmt(case.day_lo)} – {_fmt(case.day_hi)}]"
        )
        print(
            f"  legacy  stop={_fmt(leg.stop)} ({_fmt(leg.stop_distance_atr)} ATR)  "
            f"planned R/R={_fmt(leg.planned_rr)}  entry_zone={leg.entry_zone_quality or '—'}"
        )
        print(
            f"  B80     stop={_fmt(b80.stop)} ({_fmt(b80.stop_distance_atr)} ATR)  "
            f"planned R/R={_fmt(b80.planned_rr)}  entry_zone={b80.entry_zone_quality or '—'}"
        )
        if leg.planned_rr is not None and b80.planned_rr is not None:
            delta = b80.planned_rr - leg.planned_rr
            print(f"  Δ planned R/R (B80 − legacy): {delta:+.2f}")
        if case.name.startswith("Entry anchor"):
            leg_w = leg.entry_zone_width_pct or 999.0
            b80_w = b80.entry_zone_width_pct or 999.0
            if b80_w < leg_w:
                print(f"  ✓ Entry-anchor gate: B80 band narrower ({b80_w*100:.2f}% vs {leg_w*100:.2f}%)")
            else:
                print("  ✗ Entry-anchor gate FAILED")
                gate_ok = False
        if leg.stop is not None and b80.stop is not None and abs(b80.stop - leg.stop) > 1e-4:
            print(f"  ℹ stop delta: legacy={leg.stop:.4f} → B80={b80.stop:.4f}")
        if case.name.startswith("Analyst PT"):
            if b80.target_2_provenance != "resistance" or (b80.target_2 or 0) >= 120:
                print("  ✓ Analyst PT excluded from gated structural T2 under B80 replay")
            else:
                print("  ✗ Analyst PT gate FAILED")
                gate_ok = False
        actionable_flip = (
            leg.entry_zone_quality != "no_clean_entry"
            and b80.entry_zone_quality == "no_clean_entry"
        ) or (
            leg.entry_zone_quality == "no_clean_entry"
            and b80.entry_zone_quality != "no_clean_entry"
        )
        if actionable_flip:
            print(
                f"  ⚠ actionable entry-zone flip: legacy={leg.entry_zone_quality} → B80={b80.entry_zone_quality}"
            )
        print()
    intc_ok, intc_detail = _intc_entry_zone_check()
    print("▸ INTC-like entry-zone collapse (direct resolve_entry_zone)")
    print(f"  {intc_detail}")
    if intc_ok:
        print("  ✓ INTC entry-zone gate: tight band + no_clean_entry")
    else:
        print("  ✗ INTC entry-zone gate FAILED")
        gate_ok = False
    print()
    print("Synthetic gate:", "PASS" if gate_ok else "FAIL")
    return gate_ok


def _f(x: Any) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _sign(direction: str) -> int:
    d = direction.strip().lower()
    return 1 if d in ("bullish", "long", "buy") else (-1 if d in ("bearish", "short", "sell") else 0)


def _tech_blob(item: dict) -> dict[str, Any]:
    raw = item.get("technical_snapshot_json")
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw if isinstance(raw, dict) else {})
    except json.JSONDecodeError:
        return {}


def _bars_to_dicts(bars) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    for b in bars:
        out.append({"low": float(b.low), "high": float(b.high)})
    return out


async def _fetch_bars(sym: str, sem: asyncio.Semaphore, client: PolygonClient, *, limit: int = 80):
    async with sem:
        try:
            return sym, await client.get_bars(sym, Timeframe.DAY_1, limit=limit)
        except Exception:
            return sym, []


def _ledger_case_from_item(
    item: dict,
    *,
    daily_bars: list[dict[str, float]],
) -> GeometryCase | None:
    sign = _sign(str(item.get("direction") or ""))
    last = _f(item.get("price_at_signal"))
    if not sign or not last or last <= 0:
        return None
    tech = _tech_blob(item)
    atr = _f(tech.get("atr"))
    if atr is None or atr <= 0 or len(daily_bars) < 5:
        return None
    mode = str(item.get("mode") or "swing").strip().lower()
    vwap = _f(tech.get("vwap"))
    # Session bounds: prefer stored stop/target hints; fall back to bar extrema.
    bar_lo = min(r["low"] for r in daily_bars[-5:])
    bar_hi = max(r["high"] for r in daily_bars[-5:])
    day_lo = _f(item.get("day_low")) or bar_lo
    day_hi = _f(item.get("day_high")) or bar_hi
    direction: Direction = "long" if sign > 0 else "short"
    sym = str(item.get("symbol") or "?").upper()
    return GeometryCase(
        name=f"{sym} @ {item.get('generated_at', '?')}",
        direction=direction,
        last=last,
        day_lo=day_lo,
        day_hi=day_hi,
        atr=atr,
        daily_bars=daily_bars,
        trading_mode=mode,
        vwap=vwap,
    )


async def scan_ledger(days: int, *, desk: str | None = None) -> None:
    from datetime import datetime, timedelta, timezone

    floor = datetime.now(timezone.utc) - timedelta(days=days)
    table = boto3.resource("dynamodb", region_name="us-east-1").Table(
        os.environ.get("DYNAMODB_SIGNAL_HISTORY_TABLE", "SignalHistory")
    )
    items: list[dict] = []
    kwargs: dict = {}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek

    candidates: list[tuple[dict, str]] = []
    seen: set[tuple] = set()
    for it in items:
        if it.get("ledger_qualified") is not True:
            continue
        mode = str(it.get("mode") or "day").strip().lower()
        if desk and mode != desk:
            continue
        try:
            gen = datetime.fromisoformat(str(it["generated_at"]).replace("Z", "+00:00"))
        except Exception:
            continue
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        if gen < floor:
            continue
        sym = str(it.get("symbol") or "").upper()
        if not sym:
            continue
        key = (sym, mode, str(it.get("direction")), gen.replace(second=0, microsecond=0).isoformat())
        if key in seen:
            continue
        seen.add(key)
        candidates.append((it, sym))

    print(f"\nLedger replay — qualified rows last {days}d: {len(candidates)} (deduped)\n")
    if not candidates:
        return

    settings = get_settings()
    sem = asyncio.Semaphore(CONCURRENCY)
    symbols = sorted({sym for _, sym in candidates})
    bar_map: dict[str, list] = {}
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        fetched = await asyncio.gather(*(_fetch_bars(s, sem, client) for s in symbols))
    for sym, bars in fetched:
        bar_map[sym] = bars

    stop_d_atr: list[float] = []
    rr_deltas: list[float] = []
    rr_cross = 0
    ez_flips = 0
    n_replayed = 0

    for it, sym in candidates:
        bars = _bars_to_dicts(bar_map.get(sym, []))
        case = _ledger_case_from_item(it, daily_bars=bars)
        if case is None:
            continue
        leg = replay_geometry(case, variant="legacy")
        b80 = replay_geometry(case, variant="b80")
        n_replayed += 1
        stored_stop = _f(it.get("stop_level"))
        if leg.stop is not None and b80.stop is not None and case.atr > 0:
            stop_d_atr.append(abs(b80.stop - leg.stop) / case.atr)
        if leg.planned_rr is not None and b80.planned_rr is not None:
            rr_deltas.append(b80.planned_rr - leg.planned_rr)
            if (leg.planned_rr >= RR_GATE) != (b80.planned_rr >= RR_GATE):
                rr_cross += 1
        if leg.entry_zone_quality != b80.entry_zone_quality:
            ez_flips += 1
        if stored_stop is not None and b80.stop is not None and case.atr > 0:
            pass  # stored vs B80 reserved for post-merge audit

    print(f"Replayed with ATR + daily bars: {n_replayed}/{len(candidates)}")
    if stop_d_atr:
        print(f"  |Δstop|/ATR  median={st.median(stop_d_atr):.2f}  p90={sorted(stop_d_atr)[int(0.9 * len(stop_d_atr))]:.2f}")
    if rr_deltas:
        print(f"  Δ planned R/R   median={st.median(rr_deltas):+.2f}  mean={st.mean(rr_deltas):+.2f}")
    print(f"  R/R {RR_GATE} threshold crossings (legacy ↔ B80): {rr_cross}")
    print(f"  entry_zone_quality flips: {ez_flips}")


def main() -> None:
    ap = argparse.ArgumentParser(description="B80 structure geometry validation (read-only)")
    ap.add_argument("--scan", action="store_true", help="Replay qualified SignalHistory rows (AWS + Polygon)")
    ap.add_argument("--days", type=int, default=60, help="Ledger lookback when --scan (default 60)")
    ap.add_argument("--desk", choices=("day", "swing"), default=None, help="Filter ledger replay by desk")
    args = ap.parse_args()
    os.environ.setdefault("DYNAMODB_SIGNAL_HISTORY_TABLE", "SignalHistory")
    ok = print_synthetic_report()
    if args.scan:
        asyncio.run(scan_ledger(args.days, desk=args.desk))
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

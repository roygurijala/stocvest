"""Phase 0 — per-layer attribution + R:R-surfacing-gate replay (read-only).

Builds on ``replay_qualified_exits``: re-derives each qualified signal's
"as-traded" exit from Polygon bars, then answers two questions:

  A. ATTRIBUTION — which layers / context separate winners from losers?
     Layer scores are signed (~[-1, 1]); we direction-align them
     (aligned = raw * sign(direction)) so "agrees with the trade" is positive
     regardless of long/short. We report winners-vs-losers mean, a simple
     Pearson correlation with realized return, and tercile hit/expectancy.
     Categorical context (setup_type, regime, vwap_state, sector, direction)
     is grouped the same way.

  B. R:R GATE — planned reward:risk at signal time
     (|target-entry| / |entry-stop|). We re-report n / hit / expectancy after
     filtering to trades that clear each threshold, to quantify the lift from
     simply *not surfacing* poor-geometry setups. Nothing is changed in prod.

Usage:
  python scripts/analyze_signal_attribution.py --days 60
  python scripts/analyze_signal_attribution.py --days 60 --csv attr.csv
"""

from __future__ import annotations

import argparse
import asyncio
import math
import os
import statistics as st
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import boto3

_ET = ZoneInfo("America/New_York")

from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings

from replay_qualified_exits import (  # type: ignore
    CONCURRENCY,
    Trade,
    _f,
    _resolve,
    _sign,
)

LAYERS = ("technical", "news", "macro", "sector", "geopolitical", "internals")
RR_THRESHOLDS = (0.0, 1.0, 1.25, 1.5, 2.0, 2.5)


@dataclass
class Meta:
    sign: int
    layers: dict[str, float] = field(default_factory=dict)
    planned_rr: float | None = None
    setup_type: str = "None"
    regime: str = "None"
    vwap_state: str = "None"
    sector_label: str = "None"
    direction: str = "None"
    s100: float | None = None  # decision score 0-100 from gate_status_json
    rvol: float | None = None  # ticker volume vs ADV from technical_snapshot_json


def _extract_rvol(item: dict) -> float | None:
    raw = item.get("technical_snapshot_json")
    if not raw:
        return None
    try:
        import json
        blob = json.loads(raw) if isinstance(raw, str) else raw
        v = blob.get("volume_vs_adv")
        return float(v) if v is not None else None
    except Exception:
        return None


def _extract_s100(item: dict) -> float | None:
    raw = item.get("gate_status_json")
    if not raw:
        return None
    try:
        import json
        blob = json.loads(raw) if isinstance(raw, str) else raw
        v = (blob.get("gates", {}) or {}).get("decision_score", {}).get("value")
        return float(v) if v is not None else None
    except Exception:
        return None


def _planned_rr(entry: float, stop: float | None, target: float | None) -> float | None:
    if stop is None or target is None or entry <= 0:
        return None
    risk = abs(entry - stop)
    reward = abs(target - entry)
    if risk <= 1e-9:
        return None
    return reward / risk


def _scan_with_meta(days: int, desk: str | None) -> list[tuple[Trade, Meta]]:
    floor = datetime.now(timezone.utc) - timedelta(days=days)
    table = boto3.resource("dynamodb", region_name="us-east-1").Table("SignalHistory")
    seen: dict[tuple, tuple[Trade, Meta]] = {}
    kwargs: dict = {}
    while True:
        resp = table.scan(**kwargs)
        for it in resp.get("Items", []):
            if it.get("ledger_qualified") is not True:
                continue
            sign = _sign(str(it.get("direction") or ""))
            entry = _f(it.get("price_at_signal"))
            if not sign or not entry or entry <= 0:
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
            direction = str(it["direction"]).strip().lower()
            key = (it.get("symbol", "").upper(), mode, direction,
                   gen.replace(second=0, microsecond=0).isoformat(), round(entry, 2))
            if key in seen:
                continue
            stop = _f(it.get("stop_level"))
            target = _f(it.get("reference_structure_level"))
            t = Trade(symbol=str(it["symbol"]).upper(), mode=mode, direction=direction,
                      entry=entry, stop=stop, target=target, generated_at=gen)
            ls_raw = it.get("layer_scores") or {}
            layers = {}
            if isinstance(ls_raw, dict):
                for k, v in ls_raw.items():
                    fv = _f(v)
                    if fv is not None:
                        layers[str(k)] = fv
            m = Meta(
                sign=sign, layers=layers,
                planned_rr=_planned_rr(entry, stop, target),
                setup_type=str(it.get("setup_type")),
                regime=str(it.get("regime_label_at_entry")),
                vwap_state=str(it.get("vwap_state_at_entry")),
                sector_label=str(it.get("sector_label_at_entry")),
                direction=direction,
                s100=_extract_s100(it),
                rvol=_extract_rvol(it),
            )
            seen[key] = (t, m)
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return list(seen.values())


def _stats(rets: list[float], rmults: list[float] | None = None) -> dict:
    wins = [x for x in rets if x > 1e-9]
    losses = [x for x in rets if x < -1e-9]
    aw = st.mean(wins) if wins else 0.0
    al = st.mean(losses) if losses else 0.0
    decided = len(wins) + len(losses)
    return {
        "n": len(rets),
        "hit": (len(wins) / decided) if decided else float("nan"),
        "aw": aw, "al": al,
        "rr": (aw / abs(al)) if al else float("inf"),
        "exp": st.mean(rets) if rets else float("nan"),
        "expR": (st.mean(rmults) if rmults else None),
    }


def _fmt(s: dict, label: str) -> str:
    expr = f"  expR={s['expR']:+.3f}R" if s.get("expR") is not None else ""
    return (f"  {label:<22} n={s['n']:>4}  hit={s['hit']*100:>5.1f}%  "
            f"aw={s['aw']*100:+5.2f}% al={s['al']*100:+5.2f}% R:R={s['rr']:>4.2f}  "
            f"exp={s['exp']*100:+6.3f}%{expr}")


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def _report_layers(rows: list[tuple[Trade, Meta]]) -> None:
    print("\n" + "=" * 78)
    print("A1. PER-LAYER ATTRIBUTION  (aligned score = raw * direction sign)")
    print("    higher aligned = layer agreed with the trade direction")
    print("=" * 78)
    for layer in LAYERS:
        pairs = [(m.layers[layer] * m.sign, t.ret)
                 for t, m in rows if t.ret is not None and layer in m.layers]
        if len(pairs) < 6:
            print(f"\n{layer.upper():<13} insufficient data (n={len(pairs)})")
            continue
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        win_x = [x for x, y in pairs if y > 1e-9]
        los_x = [x for x, y in pairs if y < -1e-9]
        r = _pearson(xs, ys)
        rtxt = f"{r:+.3f}" if r is not None else "n/a"
        wm = st.mean(win_x) if win_x else float("nan")
        lm = st.mean(los_x) if los_x else float("nan")
        print(f"\n{layer.upper():<13} n={len(pairs)}  corr(aligned,ret)={rtxt}  "
              f"winners_mean={wm:+.3f}  losers_mean={lm:+.3f}  gap={wm - lm:+.3f}")
        # terciles by aligned score
        srt = sorted(pairs, key=lambda p: p[0])
        k = len(srt) // 3
        if k >= 2:
            bands = [("low ", srt[:k]), ("mid ", srt[k:2 * k]), ("high", srt[2 * k:])]
            for name, band in bands:
                rng = f"[{band[0][0]:+.2f},{band[-1][0]:+.2f}]"
                print(_fmt(_stats([y for _, y in band]), f"{name} {rng}"))


def _report_categorical(rows: list[tuple[Trade, Meta]]) -> None:
    print("\n" + "=" * 78)
    print("A2. CONTEXT ATTRIBUTION")
    print("=" * 78)
    dims = {
        "setup_type": lambda m: m.setup_type,
        "regime_label": lambda m: m.regime,
        "vwap_state": lambda m: m.vwap_state,
        "sector_label": lambda m: m.sector_label,
        "direction": lambda m: m.direction,
    }
    for dim, fn in dims.items():
        groups: dict[str, list[float]] = defaultdict(list)
        for t, m in rows:
            if t.ret is not None:
                groups[fn(m)].append(t.ret)
        print(f"\n[{dim}]")
        for key in sorted(groups, key=lambda g: -len(groups[g])):
            if len(groups[key]) < 3:
                continue
            print(_fmt(_stats(groups[key]), key))


def _report_time_of_day(rows: list[tuple[Trade, Meta]]) -> None:
    print("\n" + "=" * 78)
    print("A3. SESSION-PHASE / TIME-OF-DAY ATTRIBUTION (day desk, ET firing time)")
    print("=" * 78)
    day_rows = [(t, m) for t, m in rows if t.mode == "day" and t.ret is not None]
    phases: dict[str, list[float]] = defaultdict(list)
    hours: dict[str, list[float]] = defaultdict(list)
    for t, _ in day_rows:
        et = t.generated_at.astimezone(_ET)
        hm = et.hour * 60 + et.minute
        if hm < 9 * 60 + 30:
            phase = "1 pre_market(<9:30)"
        elif hm < 10 * 60:
            phase = "2 opening(9:30-10:00)"
        elif hm < 12 * 60:
            phase = "3 morning(10-12)"
        elif hm < 14 * 60:
            phase = "4 midday(12-14)"
        elif hm <= 16 * 60:
            phase = "5 close(14-16)"
        else:
            phase = "6 post_market(>16)"
        phases[phase].append(t.ret)
        hours[f"{et.hour:02d}:00 ET"].append(t.ret)
    print("\n[session phase]")
    for key in sorted(phases):
        if len(phases[key]) >= 3:
            print(_fmt(_stats(phases[key]), key))
    print("\n[ET hour]")
    for key in sorted(hours):
        if len(hours[key]) >= 3:
            print(_fmt(_stats(hours[key]), key))


def _report_deadzone_penalty(rows: list[tuple[Trade, Meta]]) -> None:
    """Simulate the B77 midday score-penalty gate (penalty on s100 vs MIN=72)."""
    MIN_ACTIONABLE = 72.0
    print("\n" + "=" * 78)
    print("A4. MIDDAY SCORE-PENALTY SIMULATION (day desk; decision score s100, MIN=72)")
    print("   penalty applied only to 12:00-14:00 ET fires; drop if s100-penalty < 72")
    print("   (RVOL override NOT modeled here \u2014 it only re-admits, so this is a floor)")
    print("=" * 78)
    day = [(t, m) for t, m in rows if t.mode == "day" and t.ret is not None]
    have_s = [(t, m) for t, m in day if m.s100 is not None]
    print(f"\nday trades: {len(day)}  with s100: {len(have_s)}")

    def _is_mid(t: Trade) -> bool:
        et = t.generated_at.astimezone(_ET)
        hm = et.hour * 60 + et.minute
        return 12 * 60 <= hm < 14 * 60

    mid = [(t, m) for t, m in have_s if _is_mid(t)]
    non_mid = [(t, m) for t, m in have_s if not _is_mid(t)]
    # s100 distribution of midday trades
    if mid:
        ss = sorted(m.s100 for _, m in mid)
        print(f"\nmidday s100: min={ss[0]:.0f} p50={ss[len(ss)//2]:.0f} max={ss[-1]:.0f}")
        for lo, hi in [(72, 82), (82, 87), (87, 92), (92, 101)]:
            band = [t.ret for t, m in mid if lo <= (m.s100 or 0) < hi]
            if band:
                print(_fmt(_stats(band), f"midday s100 [{lo},{hi})"))

    print("\n[simulated day-desk expectancy after gate]")
    print(_fmt(_stats([t.ret for t, _ in have_s]), "baseline (no gate)"))
    for penalty in (0, 10, 12, 15, 999):  # 999 == hard block of midday
        kept = []
        dropped = 0
        for t, m in have_s:
            if _is_mid(t) and (float(m.s100 or 0) - penalty) < MIN_ACTIONABLE:
                dropped += 1
                continue
            kept.append(t.ret)
        label = "hard-block midday" if penalty == 999 else f"penalty -{penalty}"
        s = _stats(kept)
        print(f"  {label:<20} drop={dropped:>3}  keep={len(kept):>3}  "
              f"hit={s['hit']*100:5.1f}%  exp={s['exp']*100:+6.3f}%")


def _report_rvol(rows: list[tuple[Trade, Meta]]) -> None:
    """Validate the B77 RVOL override: does high relative-volume rescue midday?"""
    print("\n" + "=" * 78)
    print("A5. RVOL (volume vs ADV) VALIDATION \u2014 day desk")
    print("   tests the Phase-2/3 hypothesis: is low participation the midday driver?")
    print("=" * 78)
    day = [(t, m) for t, m in rows if t.mode == "day" and t.ret is not None]
    have = [(t, m) for t, m in day if m.rvol is not None]
    print(f"\nday trades: {len(day)}  with rvol in snapshot: {len(have)}")
    if not have:
        print("  (no rvol persisted \u2014 cannot validate)")
        return

    def _is_mid(t: Trade) -> bool:
        et = t.generated_at.astimezone(_ET)
        return 12 * 60 <= (et.hour * 60 + et.minute) < 14 * 60

    print("\n[all day trades by RVOL band]")
    for lo, hi in [(0.0, 1.0), (1.0, 1.5), (1.5, 2.0), (2.0, 3.0), (3.0, 1e9)]:
        band = [t.ret for t, m in have if lo <= (m.rvol or 0) < hi]
        if len(band) >= 3:
            tag = f"RVOL [{lo:.1f},{hi:.0f})" if hi < 1e8 else f"RVOL >={lo:.1f}"
            print(_fmt(_stats(band), tag))

    mid = [(t, m) for t, m in have if _is_mid(t)]
    print(f"\n[MIDDAY (12-14 ET) by RVOL band]  midday n={len(mid)}")
    for lo, hi in [(0.0, 2.0), (2.0, 1e9)]:
        band = [t.ret for t, m in mid if lo <= (m.rvol or 0) < hi]
        if band:
            tag = "midday RVOL <2.0" if hi < 1e8 else "midday RVOL >=2.0 (override)"
            print(_fmt(_stats(band), tag))


def _report_rr_gate(rows: list[tuple[Trade, Meta]]) -> None:
    print("\n" + "=" * 78)
    print("B. R:R SURFACING-GATE REPLAY  (planned R:R = |tgt-entry|/|entry-stop|)")
    print("   keep only trades whose planned R:R >= threshold, then re-measure")
    print("=" * 78)
    have_rr = [(t, m) for t, m in rows if t.ret is not None and m.planned_rr is not None]
    no_rr = sum(1 for t, m in rows if t.ret is not None and m.planned_rr is None)
    print(f"\nreplayable with planned R:R: {len(have_rr)}  (no stop/target: {no_rr})")
    for scope, sub in (("ALL", have_rr),
                       ("DAY", [(t, m) for t, m in have_rr if t.mode == "day"]),
                       ("SWING", [(t, m) for t, m in have_rr if t.mode == "swing"])):
        if not sub:
            continue
        print(f"\n[{scope}]")
        for thr in RR_THRESHOLDS:
            kept = [(t, m) for t, m in sub if (m.planned_rr or 0) >= thr]
            if not kept:
                print(f"  R:R>={thr:<4}  (none)")
                continue
            rets = [t.ret for t, _ in kept]
            rmults = [t.r_multiple for t, _ in kept if t.r_multiple is not None]
            pct_kept = 100.0 * len(kept) / len(sub)
            print(_fmt(_stats(rets, rmults), f"R:R>={thr:<4} keep={pct_kept:4.0f}%"))


async def _run(days: int, desk: str | None, csv_path: str | None) -> int:
    os.environ.setdefault("DYNAMODB_SIGNAL_HISTORY_TABLE", "SignalHistory")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    get_settings.cache_clear()
    settings = get_settings()
    rows = _scan_with_meta(days, desk)
    print(f"qualified unique signals (last {days}d, desk={desk or 'all'}): {len(rows)}")
    cache: dict = {}
    sem = asyncio.Semaphore(CONCURRENCY)
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        async def _one(pair: tuple[Trade, Meta]) -> None:
            async with sem:
                await _resolve(client, pair[0], cache)
        chunk = 40
        items = rows
        for i in range(0, len(items), chunk):
            await asyncio.gather(*(_one(p) for p in items[i:i + chunk]))
            print(f"  replayed {min(i + chunk, len(items))}/{len(items)}", flush=True)

    done = [(t, m) for t, m in rows if t.ret is not None]
    print(f"\nreplayable: {len(done)}/{len(rows)}")
    print(_fmt(_stats([t.ret for t, _ in done],
                      [t.r_multiple for t, _ in done if t.r_multiple is not None]),
               "BASELINE (all)"))
    _report_layers(done)
    _report_categorical(done)
    _report_time_of_day(done)
    _report_deadzone_penalty(done)
    _report_rvol(done)
    _report_rr_gate(done)

    if csv_path:
        import csv as _csv
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = _csv.writer(fh)
            w.writerow(["symbol", "mode", "direction", "entry", "stop", "target",
                        "planned_rr", "exit_rule", "ret", "r_multiple",
                        *[f"layer_{l}" for l in LAYERS],
                        "setup_type", "regime", "vwap_state", "sector_label"])
            for t, m in done:
                w.writerow([t.symbol, t.mode, t.direction, t.entry, t.stop, t.target,
                            None if m.planned_rr is None else round(m.planned_rr, 3),
                            t.exit_rule,
                            None if t.ret is None else round(t.ret, 5),
                            None if t.r_multiple is None else round(t.r_multiple, 3),
                            *[m.layers.get(l) for l in LAYERS],
                            m.setup_type, m.regime, m.vwap_state, m.sector_label])
        print(f"\nwrote {csv_path} ({len(done)} rows)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--desk", choices=["day", "swing"], default=None)
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()
    return asyncio.run(_run(args.days, args.desk, args.csv))


if __name__ == "__main__":
    raise SystemExit(main())

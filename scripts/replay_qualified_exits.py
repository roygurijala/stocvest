"""Phase 0 — historical replay of rule-based exits for qualified ledger signals.

Read-only analysis. Re-derives each qualified signal's "as-traded" exit from
Polygon bars using the same rule family the live monitor enforces, then reports
realized expectancy, R:R, R-multiple, and MAE/MFE by desk.

Exit model
----------
Day (1-min bars, entry session only):
  Per bar from entry forward, first match wins —
    1. stop touched      (bull: low<=stop / bear: high>=stop)   -> fill at stop
    2. target touched    (bull: high>=tgt / bear: low<=tgt)     -> fill at target
    3. VWAP violation    (close vs cumulative session VWAP)     -> fill at close
    4. time flatten      (>= 15:55 ET)                          -> fill at close
  Fallback: regular session close (16:00 ET) last RTH bar.

Swing (daily bars, evaluated after each close, up to MAX_HOLD_CALENDAR_DAYS_SWING):
    1. structure stop    (close vs stop)                        -> fill at close
    2. target touched    (high/low)                             -> fill at target
    3. max hold reached                                         -> fill at close
  (Regime-veto exit is omitted here — needs macro history; noted as a limitation.)

Caveats: intrabar stop-before-target assumption is conservative; fills assume the
exact level (no slippage); no fees. Twins (user row + public mirror) are de-duped.

Usage:
  python scripts/replay_qualified_exits.py --days 21
  python scripts/replay_qualified_exits.py --days 21 --desk day --csv out.csv
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import statistics as st
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import boto3

from stocvest.data.models import Bar, Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.config import get_settings

ET = ZoneInfo("America/New_York")
RTH_OPEN = time(9, 30)
RTH_CLOSE = time(16, 0)
FLATTEN_ET = time(15, 55)
MAX_HOLD_DAYS_SWING = 20
VWAP_EPS = 1e-3
CONCURRENCY = 8


@dataclass
class Trade:
    symbol: str
    mode: str
    direction: str
    entry: float
    stop: float | None
    target: float | None
    generated_at: datetime
    exit_price: float | None = None
    exit_rule: str | None = None
    ret: float | None = None  # signed fraction
    r_multiple: float | None = None
    mae: float | None = None  # worst adverse excursion (fraction, <=0)
    mfe: float | None = None  # best favorable excursion (fraction, >=0)
    hold_min: int | None = None


def _sign(direction: str) -> int:
    d = direction.strip().lower()
    return 1 if d in ("bullish", "long", "buy") else (-1 if d in ("bearish", "short", "sell") else 0)


def _f(x) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _scan_qualified(days: int, desk: str | None) -> list[Trade]:
    floor = datetime.now(timezone.utc) - timedelta(days=days)
    table = boto3.resource("dynamodb", region_name="us-east-1").Table("SignalHistory")
    seen: dict[tuple, Trade] = {}
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
            # De-dupe twins (user row + public mirror share symbol/time/price/dir).
            key = (it.get("symbol", "").upper(), mode, direction,
                   gen.replace(second=0, microsecond=0).isoformat(), round(entry, 2))
            if key in seen:
                continue
            seen[key] = Trade(
                symbol=str(it["symbol"]).upper(),
                mode=mode,
                direction=direction,
                entry=entry,
                stop=_f(it.get("stop_level")),
                target=_f(it.get("reference_structure_level")),
                generated_at=gen,
            )
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return list(seen.values())


def _cumulative_vwap(bars: list[Bar]) -> list[float]:
    out: list[float] = []
    pv = 0.0
    vol = 0.0
    for b in bars:
        typical = b.vwap if (b.vwap and b.vwap > 0) else (b.high + b.low + b.close) / 3.0
        pv += typical * (b.volume or 0.0)
        vol += b.volume or 0.0
        out.append(pv / vol if vol > 0 else typical)
    return out


def _excursions(sign: int, entry: float, bars: list[Bar]) -> tuple[float, float]:
    """(mae<=0, mfe>=0) as signed fractions over the held bars."""
    mae = 0.0
    mfe = 0.0
    for b in bars:
        fav = sign * (b.high - entry) / entry if sign > 0 else sign * (b.low - entry) / entry
        adv = sign * (b.low - entry) / entry if sign > 0 else sign * (b.high - entry) / entry
        mfe = max(mfe, fav)
        mae = min(mae, adv)
    return mae, mfe


def _replay_day(t: Trade, bars: list[Bar]) -> Trade:
    sign = _sign(t.direction)
    rth = [b for b in bars if RTH_OPEN <= b.timestamp.astimezone(ET).time() <= RTH_CLOSE]
    if not rth:
        return t
    vwaps = _cumulative_vwap(rth)
    start = next((i for i, b in enumerate(rth) if b.timestamp >= t.generated_at), None)
    if start is None:
        start = len(rth) - 1
    held: list[Bar] = []
    for i in range(start, len(rth)):
        b = rth[i]
        held.append(b)
        et_t = b.timestamp.astimezone(ET).time()
        # 1) stop, 2) target (intrabar touch; stop wins ties, conservative)
        if t.stop is not None:
            if (sign > 0 and b.low <= t.stop) or (sign < 0 and b.high >= t.stop):
                return _finish(t, sign, t.stop, "day_stop", held)
        if t.target is not None:
            if (sign > 0 and b.high >= t.target) or (sign < 0 and b.low <= t.target):
                return _finish(t, sign, t.target, "day_target", held)
        # 3) VWAP violation on close
        vw = vwaps[i]
        if sign > 0 and b.close < vw * (1 - VWAP_EPS):
            return _finish(t, sign, b.close, "day_vwap_violation", held)
        if sign < 0 and b.close > vw * (1 + VWAP_EPS):
            return _finish(t, sign, b.close, "day_vwap_violation", held)
        # 4) time flatten
        if et_t >= FLATTEN_ET:
            return _finish(t, sign, b.close, "day_time_flatten", held)
    return _finish(t, sign, rth[-1].close, "day_rth_session_close", held)


def _replay_swing(t: Trade, bars: list[Bar]) -> Trade:
    sign = _sign(t.direction)
    gen_d = t.generated_at.astimezone(ET).date()
    fwd = [b for b in bars if b.timestamp.astimezone(ET).date() > gen_d]
    if not fwd:
        return t
    held: list[Bar] = []
    for b in fwd:
        held.append(b)
        days_open = (b.timestamp.astimezone(ET).date() - gen_d).days
        if t.stop is not None:
            if (sign > 0 and b.close <= t.stop) or (sign < 0 and b.close >= t.stop):
                return _finish(t, sign, b.close, "swing_structure_invalidated", held)
        if t.target is not None:
            if (sign > 0 and b.high >= t.target) or (sign < 0 and b.low <= t.target):
                return _finish(t, sign, t.target, "swing_target", held)
        if days_open >= MAX_HOLD_DAYS_SWING:
            return _finish(t, sign, b.close, "swing_max_hold_days", held)
    return _finish(t, sign, fwd[-1].close, "swing_open_window_end", held)


def _finish(t: Trade, sign: int, exit_px: float, rule: str, held: list[Bar]) -> Trade:
    t.exit_price = exit_px
    t.exit_rule = rule
    t.ret = sign * (exit_px - t.entry) / t.entry
    if t.stop is not None and abs(t.entry - t.stop) > 1e-9:
        risk = abs(t.entry - t.stop) / t.entry
        t.r_multiple = t.ret / risk if risk > 0 else None
    t.mae, t.mfe = _excursions(sign, t.entry, held or [])
    if held:
        t.hold_min = int((held[-1].timestamp - t.generated_at).total_seconds() // 60)
    return t


async def _resolve(client: PolygonClient, t: Trade, cache: dict) -> Trade:
    try:
        if t.mode == "day":
            d = t.generated_at.astimezone(ET).date().isoformat()
            ck = (t.symbol, d)
            if ck not in cache:
                cache[ck] = await client.get_bars(t.symbol, Timeframe.MIN_1, from_date=d, to_date=d, limit=50000)
            return _replay_day(t, cache[ck])
        gen_d = t.generated_at.astimezone(ET).date()
        end = min(date.today(), gen_d + timedelta(days=MAX_HOLD_DAYS_SWING + 12))
        ck = (t.symbol, gen_d.isoformat(), end.isoformat())
        if ck not in cache:
            cache[ck] = await client.get_bars(
                t.symbol, Timeframe.DAY_1, from_date=gen_d.isoformat(), to_date=end.isoformat(), limit=500
            )
        return _replay_swing(t, cache[ck])
    except Exception:
        return t


def _report(label: str, trades: list[Trade]) -> None:
    done = [t for t in trades if t.ret is not None]
    if not done:
        print(f"\n{label}: no replayable trades")
        return
    rs = [t.ret for t in done]
    wins = [x for x in rs if x > 1e-9]
    losses = [x for x in rs if x < -1e-9]
    aw = st.mean(wins) if wins else 0.0
    al = st.mean(losses) if losses else 0.0
    exp = st.mean(rs)
    rr = (aw / abs(al)) if al else float("inf")
    hit = len(wins) / (len(wins) + len(losses)) if (wins or losses) else float("nan")
    rmults = [t.r_multiple for t in done if t.r_multiple is not None]
    maes = [t.mae for t in done if t.mae is not None]
    mfes = [t.mfe for t in done if t.mfe is not None]
    print(f"\n{label}  n={len(done)}  (skipped/no-data={len(trades) - len(done)})")
    print(f"  hit rate     : {hit*100:.1f}%   win/loss={len(wins)}/{len(losses)}")
    print(f"  avg win      : {aw*100:+.2f}%   avg loss: {al*100:+.2f}%   R:R {rr:.2f}")
    print(f"  EXPECTANCY   : {exp*100:+.3f}% / trade  (summed {sum(rs)*100:+.0f}%, equal-size, gross)")
    if rmults:
        print(f"  expectancy(R): {st.mean(rmults):+.3f}R / trade  (n={len(rmults)} with a stop)")
    if maes:
        print(f"  avg MAE      : {st.mean(maes)*100:+.2f}%   avg MFE: {st.mean(mfes)*100:+.2f}%")
    print(f"  exit rules   : {dict(Counter(t.exit_rule for t in done))}")


def _write_csv(path: str, trades: list[Trade]) -> None:
    cols = ["symbol", "mode", "direction", "generated_at", "entry", "stop", "target",
            "exit_price", "exit_rule", "ret", "r_multiple", "mae", "mfe", "hold_min"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for t in trades:
            w.writerow([
                t.symbol, t.mode, t.direction, t.generated_at.isoformat(), t.entry, t.stop, t.target,
                t.exit_price, t.exit_rule,
                None if t.ret is None else round(t.ret, 5),
                None if t.r_multiple is None else round(t.r_multiple, 3),
                None if t.mae is None else round(t.mae, 5),
                None if t.mfe is None else round(t.mfe, 5),
                t.hold_min,
            ])
    print(f"\nwrote {path} ({len(trades)} rows)")


async def _run(days: int, desk: str | None, csv_path: str | None) -> int:
    os.environ.setdefault("DYNAMODB_SIGNAL_HISTORY_TABLE", "SignalHistory")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    get_settings.cache_clear()
    settings = get_settings()
    trades = _scan_qualified(days, desk)
    print(f"qualified unique signals (last {days}d, desk={desk or 'all'}): {len(trades)}")
    cache: dict = {}
    sem = asyncio.Semaphore(CONCURRENCY)
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        async def _one(t: Trade) -> Trade:
            async with sem:
                return await _resolve(client, t, cache)
        out: list[Trade] = []
        chunk = 40
        for i in range(0, len(trades), chunk):
            out.extend(await asyncio.gather(*(_one(t) for t in trades[i:i + chunk])))
            print(f"  replayed {min(i + chunk, len(trades))}/{len(trades)}", flush=True)
    _report("ALL QUALIFIED (as-traded replay)", out)
    for m in ("day", "swing"):
        sub = [t for t in out if t.mode == m]
        if sub:
            _report(f"{m.upper()} desk", sub)
    if csv_path:
        _write_csv(csv_path, out)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=21)
    ap.add_argument("--desk", choices=["day", "swing"], default=None)
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()
    return asyncio.run(_run(args.days, args.desk, args.csv))


if __name__ == "__main__":
    raise SystemExit(main())

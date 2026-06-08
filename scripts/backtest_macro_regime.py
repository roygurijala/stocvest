#!/usr/bin/env python3
"""
Compare old vs new MacroAnalyzer weights against the last N days of stored
signal records.

For each trading session in the window we extract the macro snapshot that was
captured at signal-generation time (SPY/QQQ %, VIX, events), re-run BOTH
parameter sets through the scoring formula, and report:

  • How many session days changed regime
  • Which days flipped and in which direction
  • Whether any genuinely quiet days (|SPY| < 0.5%) accidentally became risk_off

Usage (repo root, AWS creds in env):
    python scripts/backtest_macro_regime.py --days 30
    python scripts/backtest_macro_regime.py --days 30 --verbose
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from stocvest.api.services.signal_recorder import get_signal_recorder  # noqa: E402
from stocvest.api.services.historical_validation_service import HistoricalValidationService  # noqa: E402


# ── Scoring helpers (mirrors macro_analyzer.py) ──────────────────────────────

def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


VIX_TIERS = [
    (30.0, 15),
    (25.0, 30),
    (20.0, 45),
    (15.0, 65),
    (0.0,  80),
]


def _vix_score(vix: float) -> int:
    for threshold, score in VIX_TIERS:
        if vix >= threshold:
            return score
    return 80


def _momentum_score(spy_pct: float | None, qqq_pct: float | None) -> float:
    """Average only valid readings — same fix applied in macro_analyzer.py."""
    scores = []
    if spy_pct is not None:
        scores.append(_clamp(50.0 + spy_pct * 10.0, 0.0, 100.0))
    if qqq_pct is not None:
        scores.append(_clamp(50.0 + qqq_pct * 10.0, 0.0, 100.0))
    return sum(scores) / len(scores) if scores else 50.0


def classify_regime(
    spy_pct: float | None,
    qqq_pct: float | None,
    vix: float | None,
    vix_chg_pct: float | None,
    event_today: bool,
    *,
    mw: float,
    vw: float,
    ew: float,
    risk_off_ceil: int,
    risk_on_floor: int,
    vix_high: float = 30.0,
    vix_trend_thresh: float = 5.0,
    vix_falling_bonus: int = 10,
    vix_rising_penalty: int = 10,
    no_event_score: int = 60,
    event_score: int = 40,
) -> tuple[str, float]:
    """Return (regime_label, raw_score)."""
    mom = _momentum_score(spy_pct, qqq_pct)

    if vix is None:
        vs: float = 50.0
    else:
        vs = float(_vix_score(vix))
        if vix_chg_pct is not None:
            if vix_chg_pct < -vix_trend_thresh:
                vs = _clamp(vs + vix_falling_bonus, 0.0, 100.0)
            elif vix_chg_pct > vix_trend_thresh:
                vs = _clamp(vs - vix_rising_penalty, 0.0, 100.0)

    ev = float(event_score if event_today else no_event_score)
    raw = mom * mw + vs * vw + ev * ew
    score = int(round(raw))

    if vix is not None and vix > vix_high:
        return "avoid", raw
    if score >= risk_on_floor:
        return "risk_on", raw
    if score <= risk_off_ceil:
        return "risk_off", raw
    return "neutral", raw


OLD = dict(mw=0.40, vw=0.30, ew=0.30, risk_off_ceil=40, risk_on_floor=60)
NEW = dict(mw=0.45, vw=0.35, ew=0.20, risk_off_ceil=45, risk_on_floor=63)

REGIME_ORDER = {"avoid": 0, "risk_off": 1, "neutral": 2, "risk_on": 3}
REGIME_EMOJI = {"avoid": "🔴", "risk_off": "🟠", "neutral": "⚪", "risk_on": "🟢"}


# ── Fetch + deduplicate ───────────────────────────────────────────────────────

def _parse_macro(rec) -> dict | None:
    raw = getattr(rec, "macro_snapshot_json", None)
    if not raw:
        return None
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def _session_date(rec) -> str:
    """NY session date string YYYY-MM-DD from generated_at (UTC)."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    local = rec.generated_at.astimezone(et)
    return local.strftime("%Y-%m-%d")


def fetch_sessions(days: int) -> dict[str, dict]:
    """
    Returns {date_str: macro_dict} — one representative macro snapshot per
    session date (the snapshot is identical across all symbols on the same day,
    so we just keep the first one encountered that has macro data).
    """
    now = datetime.now(timezone.utc)
    from_at = now - timedelta(days=days)
    service = HistoricalValidationService(get_signal_recorder())
    records = service._fetch(user_id=None, from_at=from_at, to_at=now, mode=None, symbol=None)  # noqa: SLF001

    sessions: dict[str, dict] = {}
    for rec in records:
        d = _session_date(rec)
        if d in sessions:
            continue
        m = _parse_macro(rec)
        if m:
            sessions[d] = m

    return dict(sorted(sessions.items()))


# ── Analysis ─────────────────────────────────────────────────────────────────

def analyse(sessions: dict[str, dict], verbose: bool = False) -> None:
    rows = []
    for date, m in sessions.items():
        spy = m.get("spy_day_pct")
        qqq = m.get("qqq_day_pct")
        vix = m.get("vix_price")
        vix_chg = m.get("vix_day_change_pct")
        event = bool(m.get("economic_event_today", False))
        stored = str(m.get("market_regime") or "unknown")

        old_r, old_s = classify_regime(spy, qqq, vix, vix_chg, event, **OLD)
        new_r, new_s = classify_regime(spy, qqq, vix, vix_chg, event, **NEW)

        rows.append({
            "date": date,
            "spy": spy,
            "qqq": qqq,
            "vix": vix,
            "event": event,
            "stored": stored,
            "old": old_r,
            "old_s": old_s,
            "new": new_r,
            "new_s": new_s,
            "changed": old_r != new_r,
        })

    total = len(rows)
    changed = [r for r in rows if r["changed"]]
    flipped_bearish = [r for r in changed if REGIME_ORDER[r["new"]] < REGIME_ORDER[r["old"]]]
    flipped_bullish = [r for r in changed if REGIME_ORDER[r["new"]] > REGIME_ORDER[r["old"]]]
    quiet_risk_off = [
        r for r in rows
        if r["new"] == "risk_off"
        and r["spy"] is not None and abs(r["spy"]) < 0.5
    ]

    # Regime distribution
    old_counts: dict[str, int] = defaultdict(int)
    new_counts: dict[str, int] = defaultdict(int)
    for r in rows:
        old_counts[r["old"]] += 1
        new_counts[r["new"]] += 1

    print(f"\n{'='*60}")
    print(f"  MACRO REGIME BACKTEST — last {total} session days")
    print(f"{'='*60}")

    print(f"\n{'Regime':<12} {'Old':>6} {'New':>6}")
    print("-" * 28)
    for regime in ["risk_on", "neutral", "risk_off", "avoid"]:
        e = REGIME_EMOJI[regime]
        print(f"{e} {regime:<10} {old_counts[regime]:>6} {new_counts[regime]:>6}")

    print(f"\nDays changed:     {len(changed)}/{total}")
    print(f"  → more bearish: {len(flipped_bearish)}")
    print(f"  → more bullish: {len(flipped_bullish)}")
    print(f"Quiet days mis-classified risk_off (|SPY|<0.5%): {len(quiet_risk_off)}")

    if changed:
        print(f"\n{'Date':<12} {'SPY%':>6} {'QQQ%':>6} {'VIX':>6} {'Ev':>3} "
              f"{'Old':<10} {'New':<10} {'Δscore':>8}")
        print("-" * 68)
        for r in changed:
            spy_s = f"{r['spy']:+.1f}" if r["spy"] is not None else "  n/a"
            qqq_s = f"{r['qqq']:+.1f}" if r["qqq"] is not None else "  n/a"
            vix_s = f"{r['vix']:.1f}" if r["vix"] is not None else "  n/a"
            delta = r["new_s"] - r["old_s"]
            direction = "▼" if REGIME_ORDER[r["new"]] < REGIME_ORDER[r["old"]] else "▲"
            print(
                f"{r['date']:<12} {spy_s:>6} {qqq_s:>6} {vix_s:>6} "
                f"{'Y' if r['event'] else 'N':>3} "
                f"{r['old']:<10} {direction} {r['new']:<10} {delta:>+7.1f}"
            )

    if quiet_risk_off:
        print(f"\n⚠️  Quiet days that became risk_off (|SPY| < 0.5%):")
        for r in quiet_risk_off:
            print(f"  {r['date']}  SPY={r['spy']:+.2f}%  QQQ={r['qqq']:+.2f}%  VIX={r['vix']}  score={r['new_s']:.1f}")

    if verbose:
        print(f"\n{'Date':<12} {'SPY%':>6} {'QQQ%':>6} {'VIX':>6} {'Ev':>3} "
              f"{'Stored':<10} {'Old':<10} {'New':<10} {'Oscr':>6} {'Nscr':>6}")
        print("-" * 80)
        for r in rows:
            spy_s = f"{r['spy']:+.1f}" if r["spy"] is not None else "  n/a"
            qqq_s = f"{r['qqq']:+.1f}" if r["qqq"] is not None else "  n/a"
            vix_s = f"{r['vix']:.1f}" if r["vix"] is not None else "  n/a"
            flag = " ←" if r["changed"] else ""
            print(
                f"{r['date']:<12} {spy_s:>6} {qqq_s:>6} {vix_s:>6} "
                f"{'Y' if r['event'] else 'N':>3} "
                f"{r['stored']:<10} {r['old']:<10} {r['new']:<10} "
                f"{r['old_s']:>6.1f} {r['new_s']:>6.1f}{flag}"
            )

    print()


def main() -> int:
    p = argparse.ArgumentParser(description="Backtest old vs new macro regime weights.")
    p.add_argument("--days", type=int, default=30, help="Trailing window in calendar days.")
    p.add_argument("--verbose", action="store_true", help="Print full per-day table.")
    args = p.parse_args()

    print(f"Fetching signal records from last {args.days} days …")
    sessions = fetch_sessions(args.days)

    if not sessions:
        print("No sessions with macro data found.", file=sys.stderr)
        return 1

    analyse(sessions, verbose=args.verbose)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

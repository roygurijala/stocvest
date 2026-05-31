#!/usr/bin/env python3
"""Grid-search VIX environment enter bands against stored ledger outcomes.

Replays real ``SignalHistory`` rows (``market_environment_audit`` + outcomes). Does not
regenerate composites or simulate hysteresis.

Usage (repo root, AWS creds + table env for DynamoDB):

  python scripts/backtest_environment_policy.py --days 180 --horizon 1d --mode swing
  python scripts/backtest_environment_policy.py --days 90 --top 15 --json report.json

  # In-memory fixture (tests / local dev without Dynamo):
  python scripts/backtest_environment_policy.py --fixture tests/fixtures/ledger_env_sample.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow `python scripts/backtest_environment_policy.py` from repo root.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from stocvest.api.services.historical_validation_service import (  # noqa: E402
    MAX_LOOKBACK_DAYS,
    HistoricalValidationService,
)
from stocvest.api.services.signal_recorder import get_signal_recorder  # noqa: E402
from stocvest.data.models import SignalRecord  # noqa: E402
from stocvest.signals.environment_policy_backtest import (  # noqa: E402
    PRODUCTION_BANDS,
    candidate_metrics_to_dict,
    extract_backtest_rows,
    format_metrics_line,
    rank_candidates,
    run_grid_search,
)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backtest VIX environment enter bands on ledger rows.")
    p.add_argument("--days", type=int, default=180, help="Trailing window (max 366).")
    p.add_argument("--horizon", choices=("1h", "1d"), default="1d")
    p.add_argument("--mode", choices=("swing", "day", "all"), default="swing")
    p.add_argument("--user-id", default=None, help="Scope (default: public ledger).")
    p.add_argument("--top", type=int, default=12, help="Top candidates to print.")
    p.add_argument("--json", dest="json_path", default=None, help="Write full results JSON.")
    p.add_argument(
        "--fixture",
        default=None,
        help="JSON file: list of SignalRecord-shaped dicts (skips Dynamo).",
    )
    return p.parse_args()


def _load_fixture(path: str) -> list[SignalRecord]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("fixture must be a JSON array")
    out: list[SignalRecord] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        out.append(SignalRecord.from_dynamo_item(item))
    return out


def _fetch_records(*, days: int, user_id: str | None, mode: str | None) -> list[SignalRecord]:
    days = max(1, min(MAX_LOOKBACK_DAYS, days))
    now = datetime.now(timezone.utc)
    from_at = now - timedelta(days=days)
    service = HistoricalValidationService(get_signal_recorder())
    return service._fetch(  # noqa: SLF001 — script is operator tooling
        user_id=user_id,
        from_at=from_at,
        to_at=now,
        mode=mode if mode in ("swing", "day") else None,
        symbol=None,
    )


def _metrics_to_dict(m) -> dict:  # noqa: ANN001
    cfg = m.config
    return {
        "bands": {
            "normal_enter": cfg.normal_enter,
            "elevated_enter": cfg.elevated_enter,
            "crisis_enter": cfg.crisis_enter,
        },
        "rows_with_vix": m.rows_with_vix,
        "tier_counts": m.tier_counts,
        "tier_agreement_pct": None if m.tier_agreement_pct != m.tier_agreement_pct else round(m.tier_agreement_pct * 100, 1),
        "swing": {
            "allowed_accuracy_pct": _pct(m.swing_allowed.accuracy),
            "allowed_correct": m.swing_allowed.correct,
            "allowed_resolved": m.swing_allowed.resolved_directional,
            "blocked_accuracy_pct": _pct(m.swing_blocked.accuracy),
            "block_rate_pct": _pct(m.swing_block_rate()),
        },
        "day": {
            "allowed_accuracy_pct": _pct(m.day_allowed.accuracy),
            "blocked_accuracy_pct": _pct(m.day_blocked.accuracy),
            "block_rate_pct": _pct(m.day_block_rate()),
        },
    }


def _pct(v: float) -> float | None:
    if v != v:
        return None
    return round(v * 100, 1)


def main() -> int:
    args = _parse_args()
    mode_filter = None if args.mode == "all" else args.mode

    if args.fixture:
        records = _load_fixture(args.fixture)
    else:
        records = _fetch_records(days=args.days, user_id=args.user_id, mode=mode_filter)

    rows = extract_backtest_rows(records)
    if mode_filter:
        rows = [r for r in rows if r.mode == mode_filter]

    if not rows:
        print("No ledger rows with market_environment_audit in window.", file=sys.stderr)
        return 1

    desk_mode = "swing" if args.mode == "all" else args.mode
    results = run_grid_search(rows, horizon=args.horizon)
    ranked = rank_candidates(results, mode=desk_mode)  # type: ignore[arg-type]

    print(f"Environment policy backtest — {len(rows)} rows with VIX audit, horizon={args.horizon}")
    print(f"Production bands: normal={PRODUCTION_BANDS.normal_enter} elevated={PRODUCTION_BANDS.elevated_enter} crisis={PRODUCTION_BANDS.crisis_enter}")
    print()
    print(f"{'Bands (n/e/c)':<22} | {'n':>4} | allowed acc      | blocked acc      | block% | tier match")
    print("-" * 88)
    for m in ranked[: max(1, args.top)]:
        print(format_metrics_line(m, mode=desk_mode, horizon=args.horizon))

    best = ranked[0]
    prod = next((x for x in results if x.config.key() == PRODUCTION_BANDS.key()), None)
    if prod and best.config.key() != PRODUCTION_BANDS.key():
        print()
        print(
            f"Top candidate beats production on {desk_mode} allowed accuracy: "
            f"{format_metrics_line(best, mode=desk_mode, horizon=args.horizon)}"
        )

    if args.json_path:
        payload = {
            "horizon": args.horizon,
            "mode": args.mode,
            "rows_with_vix": len(rows),
            "candidates": [candidate_metrics_to_dict(m) for m in results],
            "ranked_keys": [m.config.key() for m in ranked],
        }
        Path(args.json_path).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

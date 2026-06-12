#!/usr/bin/env python3
"""Diagnose execution-actionable gates for a symbol using live composite data."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


def _fmt_money(v: float | None) -> str:
    if v is None:
        return "—"
    return f"${v:,.2f}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify execution-actionable gates for a symbol.")
    parser.add_argument("symbol", nargs="?", default="GGAL", help="Ticker symbol (default: GGAL)")
    args = parser.parse_args()
    sym = args.symbol.strip().upper()

    from stocvest.api.services.execution_actionable import (
        apply_entry_gates_to_response_body,
        scenario_payload_from_body,
    )
    from stocvest.api.services.swing_composite_engine import swing_composite_body_sync

    now_et = datetime.now(ET)
    print(f"=== Execution-actionable diagnosis: {sym} ===")
    print(f"Evaluated at: {now_et.isoformat()} ET")

    try:
        body = swing_composite_body_sync(symbol=sym, user_id=None, ledger_capture=False)
    except Exception as exc:
        print(f"ERROR: composite failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if body.get("error"):
        print(f"Composite error: {body.get('error')} — {body.get('message')}")
        return 1

    apply_entry_gates_to_response_body(body, mode="swing")
    scenario = scenario_payload_from_body(body, mode="swing", symbol=sym)
    gates = body.get("gate_status") if isinstance(body.get("gate_status"), dict) else {}

    print()
    print("--- Signal summary ---")
    print(f"Verdict:           {body.get('signal_summary') or body.get('verdict')}")
    print(f"Signal score:      {body.get('signal_score')}")
    print(f"Alignment ratio:   {body.get('alignment_ratio')}")
    print(f"Pattern:           {body.get('pattern')}")
    print(f"Risk/reward:       {body.get('risk_reward')}")
    print(f"Min R/R desk:      {body.get('min_rr_desk')}")
    print(f"Status:            {body.get('status')}")
    print(f"Decision state:    {body.get('decision_state')}")

    zone = body.get("historical_entry_zone") or body.get("session_entry_zone") or {}
    price = (
        (body.get("snapshot") or {}).get("last_trade_price")
        if isinstance(body.get("snapshot"), dict)
        else None
    )
    if price is None:
        price = body.get("last_trade_price")

    print()
    print("--- Entry zone ---")
    if isinstance(zone, dict):
        print(f"Zone:              {_fmt_money(zone.get('low'))} – {_fmt_money(zone.get('high'))}")
    else:
        print("Zone:              missing")
    print(f"Last price:        {_fmt_money(float(price)) if price is not None else '—'}")

    print()
    print("--- Gate results ---")
    print(f"Ledger qualified:       {body.get('ledger_qualified')}")
    print(f"Execution actionable:   {body.get('execution_actionable')}")
    entry_zone_gate = gates.get("entry_zone") if isinstance(gates.get("entry_zone"), dict) else {}
    print(f"In entry zone:          {entry_zone_gate.get('pass')}")

    failed: list[str] = []
    for key, val in sorted(gates.items()):
        if key in ("entry_zone", "execution_actionable"):
            continue
        if isinstance(val, dict) and val.get("pass") is False:
            failed.append(f"{key}: {val}")

    if failed:
        print()
        print("Failed ledger gates:")
        for row in failed:
            print(f"  - {row}")
    else:
        print("All individual ledger gates passed (or not reported).")

    print()
    print("--- Email scenario payload ---")
    print(json.dumps(scenario, indent=2, default=str))

    print()
    if body.get("execution_actionable"):
        print("VERDICT: WOULD trigger execution-actionable email now.")
    else:
        print("VERDICT: Would NOT trigger execution-actionable email now.")
        if body.get("ledger_qualified") and not entry_zone_gate.get("pass"):
            print("  Reason: price outside entry zone.")
        elif not body.get("ledger_qualified"):
            print("  Reason: ledger gates not satisfied.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

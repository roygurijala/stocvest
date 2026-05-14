"""EventBridge-scheduled gap-intel cache warmer (no HTTP envelope).

Warms a small anchor symbol list so the read-through DynamoDB cache stays
fresh between user traffic. Always returns HTTP-shaped 200 — failures are
logged only (EventBridge retry discipline matches other scheduled jobs).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Literal

from zoneinfo import ZoneInfo

from stocvest.api.services.gap_intel_compute import compute_gap_intel_body_sync
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.gap_intel_cache_store import gap_intel_cache_key, get_gap_intel_cache_row, put_gap_intel_cache_row
from stocvest.signals.gap_intel_alerts import next_last_disable_metric_timestamp
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def gap_intel_cache_tick_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    raw = ""
    if isinstance(event, dict):
        raw = str(event.get("symbols") or "").strip()
    if not raw:
        raw = os.environ.get("GAP_INTEL_TICK_SYMBOLS", "SPY,QQQ,IWM").strip()
    syms = [s.strip().upper() for s in raw.split(",") if s.strip()]
    modes_raw = ""
    if isinstance(event, dict):
        modes_raw = str(event.get("modes") or "").strip()
    modes_list = (
        ["day", "swing"]
        if not modes_raw
        else [m.strip().lower() for m in modes_raw.split(",") if m.strip()]
    )
    modes_list = [m for m in modes_list if m in ("day", "swing")] or ["day", "swing"]

    now_utc = datetime.now(tz=timezone.utc)
    session_date_et = now_utc.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    warmed: list[str] = []
    failures = 0
    for sym in syms[:12]:
        for mode in modes_list:
            tm: Literal["day", "swing"] = "swing" if mode == "swing" else "day"
            key = f"{sym}:{tm}"
            try:
                ck = gap_intel_cache_key(sym, tm, session_date_et)
                cached = get_gap_intel_cache_row(ck)
                old_sb = cached.last_sb_state if cached else None
                prior_dm = cached.last_disable_metric_at if cached else None
                body = compute_gap_intel_body_sync(sym, tm)
                merged = next_last_disable_metric_timestamp(
                    old_sb_state=old_sb,
                    prior_last_disable_metric_at=prior_dm,
                    new_body=body,
                    symbol=sym,
                    trading_mode=tm,
                )
                put_gap_intel_cache_row(ck, body, last_disable_metric_at=merged)
                warmed.append(key)
            except Exception as exc:  # noqa: BLE001
                failures += 1
                _LOG.warning("gap_intel_cache_tick %s failed: %s", key, exc)

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"warmed": warmed, "failures": failures}, separators=(",", ":")),
    }

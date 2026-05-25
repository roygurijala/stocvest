"""EventBridge-scheduled trial reminder emails (day 10 / day 14)."""

from __future__ import annotations

import json
from typing import Any

from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.trial.reminders import run_trial_reminder_tick


def trial_reminder_tick_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    result = run_trial_reminder_tick()
    body = {
        "status": "ok",
        "scanned": result.scanned,
        "day10_sent": result.day10_sent,
        "day14_sent": result.day14_sent,
        "skipped_no_email": result.skipped_no_email,
        "errors": result.errors,
    }
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, separators=(",", ":")),
    }

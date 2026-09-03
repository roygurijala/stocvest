#!/usr/bin/env python3
"""One-off: disable EventBridge Scheduler jobs (preserve target JSON)."""

from __future__ import annotations

import json
import subprocess
import sys

REGION = "us-east-1"


def main() -> int:
    raw = subprocess.check_output(
        ["aws", "scheduler", "list-schedules", "--region", REGION, "--output", "json"],
        text=True,
    )
    schedules = json.loads(raw).get("Schedules") or []
    disabled = 0
    for row in schedules:
        if row.get("State") != "ENABLED":
            continue
        name = row["Name"]
        group = row["GroupName"]
        full = json.loads(
            subprocess.check_output(
                [
                    "aws",
                    "scheduler",
                    "get-schedule",
                    "--name",
                    name,
                    "--group-name",
                    group,
                    "--region",
                    REGION,
                    "--output",
                    "json",
                ],
                text=True,
            )
        )
        target_path = f"tmp-schedule-target-{disabled}.json"
        with open(target_path, "w", encoding="utf-8") as fh:
            json.dump(full["Target"], fh)
        cmd = [
            "aws",
            "scheduler",
            "update-schedule",
            "--name",
            name,
            "--group-name",
            group,
            "--region",
            REGION,
            "--state",
            "DISABLED",
            "--schedule-expression",
            full["ScheduleExpression"],
            "--flexible-time-window",
            json.dumps(full.get("FlexibleTimeWindow") or {"Mode": "OFF"}),
            "--target",
            f"file://{target_path}",
        ]
        tz = full.get("ScheduleExpressionTimezone")
        if tz:
            cmd.extend(["--schedule-expression-timezone", tz])
        subprocess.check_call(cmd)
        print(f"disabled {name}")
        disabled += 1
    print(f"done: {disabled} schedules disabled")
    return 0


if __name__ == "__main__":
    sys.exit(main())

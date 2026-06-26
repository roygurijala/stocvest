"""Admin migration: set every user's alert preferences to "tradeable signals only".

Goal: users receive an email ONLY when a signal becomes tradeable (execution-actionable:
ledger gates passed AND price inside the entry zone). All other signal emails
(signal_fired, confluence, watchlist maturation, gap, tracked-plan thesis) are turned off.
PDT warning/blocked stay ON (account-risk/compliance safety, not signal noise).

Idempotent and rerunnable. Upserts the ``preferences`` row for every userId in the Users
table so coverage does not depend on model defaults. Quiet hours are left disabled and the
start/end strings are only seeded if absent.

Usage:
  python scripts/set_all_users_tradeable_alerts.py            # dry run (prints plan)
  python scripts/set_all_users_tradeable_alerts.py --apply    # write changes
"""

from __future__ import annotations

import argparse

import boto3

REGION = "us-east-1"


def _all_user_ids() -> list[str]:
    table = boto3.resource("dynamodb", region_name=REGION).Table("Users")
    ids: list[str] = []
    kwargs: dict = {"ProjectionExpression": "userId"}
    while True:
        resp = table.scan(**kwargs)
        for it in resp.get("Items", []):
            uid = str(it.get("userId") or "").strip()
            if uid:
                ids.append(uid)
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return ids


def _apply(uid: str, table) -> None:
    table.update_item(
        Key={"userId": uid, "alertId": "preferences"},
        UpdateExpression=(
            "SET emailEnabled = :t, onExecutionActionable = :t, "
            "onSignalFired = :f, onConfluenceAlert = :f, onWatchlistMaturation = :f, "
            "onGapDetected = :f, onTrackedPlanThesis = :f, "
            "onPdtWarning = :t, onPdtBlocked = :t, "
            "watchlistOnly = :f, quietHoursEnabled = :f, "
            "quietHoursStart = if_not_exists(quietHoursStart, :qs), "
            "quietHoursEnd = if_not_exists(quietHoursEnd, :qe)"
        ),
        ExpressionAttributeValues={
            ":t": True,
            ":f": False,
            ":qs": "22:00",
            ":qe": "07:00",
        },
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()

    ids = _all_user_ids()
    print(f"users found: {len(ids)}")
    print(
        "target prefs: emailEnabled=ON, onExecutionActionable=ON; "
        "signal_fired/confluence/maturation/gap/tracked_plan=OFF; "
        "pdt_warning/pdt_blocked=ON; watchlistOnly=OFF; quietHours=OFF"
    )
    if not args.apply:
        print("\nDRY RUN — re-run with --apply to write. First few userIds:")
        for uid in ids[:5]:
            print("  ", uid)
        return 0

    table = boto3.resource("dynamodb", region_name=REGION).Table("Alerts")
    done = 0
    for uid in ids:
        _apply(uid, table)
        done += 1
        if done % 25 == 0:
            print(f"  updated {done}/{len(ids)}")
    print(f"DONE — updated {done} users")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

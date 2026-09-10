# VAL-POS — Position validation shadow soak (runbook)

**ADR:** [ADR-004 Position Desk](../adr/ADR-004-position-desk-long-term-investment.md) · **Backlog:** POS-D9 (capture) → POS-D10 (alerts, gated on this soak) → POS-AI-8/9/11 (need soak depth)

The VAL-POS soak captures weekly **shadow** Position ledger rows over the gem universe so we can
measure the long-horizon composite's calibration **before** any position alert/email or
ledger-learned tuning is enabled. Nothing in this soak is user-facing and **no alerts fire**.

---

## 1. What it does

- **Schedule:** `aws_scheduler_schedule.scanner_ledger_capture_position` — `cron(10 16 ? * FRI *)`
  America/New_York (Friday **4:10 PM ET**, after the cash close).
- **Target:** the `scanner` Lambda with `{"scan_type": "ledger_capture_position"}`, which runs
  `stocvest/workers/ledger_capture_position.py` over `POSITION_SCAN_UNIVERSE_V1`.
- **Writes:** one `SignalRecord` per evaluated name (`mode="position"`) under the synthetic
  platform user `settings.stocvest_position_ledger_user`, mirrored to PUBLIC. Grounded entries
  (`evaluate_position_desk_entry` actionable + Friday-close window + not already open) are
  `capture_kind="qualified"` and open a validation position; everything else is `shadow`.
- **Monitor:** `ledger_position_monitor` closes open rows weekly on structural break
  (Friday close through the reference stop) or validity expiry (≤ `MAX_HOLD_CALENDAR_DAYS_POSITION`).
- **Thesis drift (POS-AI-7, informational):** each Friday sweep compares the fresh pillar
  snapshot of any **open** position against its entry-time `pillar_snapshot_json` baseline and
  reports degraded pillars in the job result / logs. Informational only — it does **not** close
  positions or fire alerts.

## 2. Start / pause / stop

The schedule is gated by the Terraform variable `position_ledger_capture_enabled` (default **true**).

```bash
# Start (default) — applying enables the Friday schedule:
terraform apply

# Pause without destroying the resource:
terraform apply -var 'position_ledger_capture_enabled=false'
```

Confirm state in AWS:

```bash
aws scheduler get-schedule --name stocvest-development-scanner-ledger-capture-position \
  --query 'State' --output text     # expect ENABLED
```

**Kill switch:** setting the var to `false` (or manually `DISABLED`) stops future captures; already
captured rows and open validation positions are unaffected (the monitor keeps closing them).

## 3. Weekly monitoring

Run the ledger report scoped to Position after each Friday capture (and review at week's end):

```bash
python scripts/ledger_signal_report.py --mode position
```

Check each week:

- **Capture health:** `evaluated`, `qualified`, `shadow`, `errors` from the job log
  (`position ledger capture done …`). `errors` should be a small fraction of the universe.
- **Coverage:** qualified + shadow rows accrue weekly; open validation positions are opening and
  closing (structural break / validity expiry) as expected.
- **Drift:** review the informational drift entries for open positions (degraded pillars).
- **No alerts:** verify no position alert/email path is live (it must not be until §5 sign-off).

## 4. Data being collected (for POS-AI-8/9/11)

- Entry: verdict, `signal_strength`, per-layer scores, `regime_label_at_entry`, `sector_label_at_entry`,
  reference stop/target, and the **entry pillar baseline** (`pillar_snapshot_json`).
- Exit: `exit_rule`/`exit_reason`, `ledger_exit_date_et`, realized outcome fields.
- These feed the future calibrated `P(outperform)` (POS-AI-8), News/decay tuning (POS-AI-9), and the
  walk-forward weight optimizer (POS-AI-11). **Do not hand-tune those constants before the soak.**

## 5. Exit criteria — before enabling Position alerts (POS-D10)

Run the soak **4–8 weeks** and require, at minimum:

1. **Sample depth:** enough closed Position rows across ≥ 2 macro regimes for a meaningful read
   (target ≥ ~40–50 closed rows; more is better for AI-8 Wilson CIs).
2. **Stability:** capture `errors` consistently low; no systematic gate/monitor failures.
3. **Calibration:** qualified-row hit-rate and R-multiple distribution reviewed and acceptable vs
   the shadow population (no obvious negative edge).
4. **Copy/compliance:** POS-D12 counsel sign-off on "gem" marketing copy (separate gate).

Only after 1–4 do we flip Position alerts/emails ON (POS-D10) and begin AI-8/9/11.

---

*Last updated: 2026-09-09.*

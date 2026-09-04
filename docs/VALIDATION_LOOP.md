# Personal validation loop (VAL-1)

Plain-English workflow for using STOCVEST as a **personal swing-first desk**: ranked market scan → deep dive → **execution-actionable email only when geometry clears** → ledger proof.

Related: [`adr/ADR-002-personal-swing-first-product-ops.md`](./adr/ADR-002-personal-swing-first-product-ops.md) (VAL-1), [`adr/ADR-003-trading-room-density-and-sleek-ux.md`](./adr/ADR-003-trading-room-density-and-sleek-ux.md) (UX-D1 desk feed as ranked queue), [`LEDGER_DAILY_VERIFICATION.md`](./LEDGER_DAILY_VERIFICATION.md), [`SIGNAL_ENGINE.md`](./SIGNAL_ENGINE.md) (geometry gates).

---

## Success metric

**Target: ≤ 5 execution-actionable emails per week** (swing + day combined), and **each email must pass GEO gates** (geometry tradeable, stop distance, honest T1/plan R/R in the email body).

If you exceed the target, gates are too loose or you are subscribed to non-essential alert types — fix prefs before changing engine thresholds.

---

## Daily workflow (weekdays)

| Step | When | Action |
|------|------|--------|
| 1 | Morning / pre-market | Open **Dashboard** → **Desk feed** (left column, default **Actionable desk** filter). Scan actionable/near cards — ranked setups from the market scan, not watchlist-only symbols. Full ranked table: **Scanner** (`/dashboard/scanner`). |
| 2 | When a row looks interesting | Open **deep dive** (single scroll: Setup → Layers → Evolution → Chart). Read **Geometry honesty** (stop distance, T1 R/R, plan R/R when applicable). |
| 3 | Before acting | Confirm `execution_actionable` would be true: price inside entry zone, ledger + geometry gates pass (see deep-dive Setup + email parity rows). |
| 4 | After **4:20 PM ET** | Run ledger daily report (below). Compare **qualified** counts to what you saw on the desk. |
| 5 | Email | Only **Execution actionable** alerts should fire for trade setups (see Settings). Cross-check each email’s stop distance and R/R rows against deep dive. |

---

## Email discipline (Settings → Alerts)

**Recommended for VAL-1:**

| Preference | Setting | Why |
|------------|---------|-----|
| Execution actionable | **On** | Only path that emails when desk + entry zone + geometry gates clear |
| Signal fired / Confluence / Gap / Watchlist maturation / Tracked plan thesis | **Off** | Avoid noise; validation is proof-of-gate, not alert volume |
| PDT warning / blocked | **On** (optional) | Compliance, not setup promotion |
| Email alerts master | **On** | Required for execution-actionable delivery |

New accounts default to this shape via `AlertPreferences` in code. Existing Dynamo rows keep saved values until you PATCH prefs or toggle in Settings.

**Gate stack for execution emails** (`execution_actionable`):

1. Ledger qualification (score, alignment, R/R, sector, environment)
2. Price inside historical/session entry zone
3. **Geometry** — `geometry_tradeability` (incl. swing stop ≥ 1.5×ATR, leveraged/inverse universe exclusion)
4. User pref `on_execution_actionable`

---

## Ledger reports

### Daily (Mon–Fri, after 4:20 PM ET)

```powershell
python scripts/ledger_signal_report.py --period daily
```

See [`LEDGER_DAILY_VERIFICATION.md`](./LEDGER_DAILY_VERIFICATION.md) for env setup and how to read qualified vs shadow rows.

### Weekly (Monday morning)

```powershell
python scripts/ledger_signal_report.py --period weekly
```

The weekly report includes a **VAL-1 checklist** section:

- Swing/day **qualified** totals for the window
- **Execution-actionable emails sent** (from Alerts history)
- Pass/fail vs the ≤ 5/week target
- Reminder to review primary shadow blockers before tuning gates

Saved under `reports/ledger/` (gitignored).

---

## Weekly review checklist

Copy this block into your notes each Monday after running the weekly report:

- [ ] **Email volume:** execution-actionable emails ≤ 5? If not, turn off non-essential alert toggles and review whether geometry gates misfired.
- [ ] **Email quality:** For each execution email received, spot-check symbol in deep dive — Geometry honesty panel matches email rows (stop distance, T1 R/R).
- [ ] **Ledger qualified:** Swing qualified count plausible vs market conditions? Zero for a full week → verify `ledger_capture_swing` schedule (post OPS-2).
- [ ] **Shadow blockers:** Top 3 primary blockers in weekly report — any unexpected gate dominating (e.g. `stop_too_tight_for_swing`, `geometry_insufficient`)?
- [ ] **No threshold changes** unless shadow telemetry reviewed for 2+ weeks (hold swing R/R at **2.0** until B62 Phase 3 decision).

---

## Optional diagnostics

```powershell
# Structure geometry batch (B80 gate)
python scripts/validate_structure_geometry.py

# Single-symbol execution-actionable breakdown
python scripts/diagnose_symbol_execution_actionable.py SYMBOL swing
```

---

## What not to do in VAL-1

- Do not lower swing R/R or disable geometry gates to “get more emails.”
- Do not treat watchlist maturation or signal-fired emails as validation proof.
- Do not change composite math based on one week of qualified=0 — use shadow row gate JSON first.

# Ledger verification — daily, weekly, and monthly

Plain-English instructions for checking how many **day** and **swing** signals STOCVEST produced, and which ones were **actionable**.

Reports are saved under **`reports/ledger/`** in this repo (not committed to git — local copies for your review).

---

## When to run

| Report | When | What it covers |
|--------|------|----------------|
| **Daily** | Each **weekday evening after 4:15 PM ET** | That trading day only |
| **Weekly** | **Monday morning** (or Friday after close) | Last 7 calendar days (ET) |
| **Monthly** | **First business day of the month** | Previous calendar month (ET) |

Ledger capture runs automatically in AWS:

- **Day desk** — about **3:55 PM ET** (`ledger_capture_day`)
- **Swing desk** — about **4:00 PM ET** (`ledger_capture_swing`)

Run your daily check **after both jobs have had time to finish** (4:15 PM ET or later).

---

## One-time setup

1. Open PowerShell in the repo root: `c:\Users\RoyGurijala\stocvest`
2. Make sure AWS can reach production DynamoDB (same creds you use for other ops scripts).
3. Set environment variables (or rely on your `.env` if already loaded):

```powershell
$env:AWS_REGION = "us-east-1"
$env:DYNAMODB_SIGNAL_HISTORY_TABLE = "SignalHistory"
$env:DYNAMODB_WATCHLIST_MATURATION_TABLE = "WatchlistMaturation"
```

4. Optional: fix a bad local `.env` line for DynamoDB endpoint (if present):

```powershell
# Only if you use a local DynamoDB — leave unset for production AWS
Remove-Item Env:DYNAMODB_ENDPOINT_URL -ErrorAction SilentlyContinue
```

---

## Commands to run

From the **repo root**:

### Daily (most important)

```powershell
python scripts/ledger_signal_report.py --period daily
```

Uses **yesterday’s date in Eastern Time** by default.  
To pin a specific day:

```powershell
python scripts/ledger_signal_report.py --period daily --date 2026-06-09
```

### Weekly

```powershell
python scripts/ledger_signal_report.py --period weekly
```

### Monthly

```powershell
python scripts/ledger_signal_report.py --period monthly --date 2026-06-01
```

(`--date` picks which month; use any day in that month.)

---

## Where reports are saved

| Period | File name example |
|--------|-------------------|
| Daily | `reports/ledger/2026-06-09_daily.txt` |
| Weekly | `reports/ledger/2026-06-09_weekly.txt` |
| Monthly | `reports/ledger/2026-06_monthly.txt` |

Open the `.txt` file in Cursor or any editor. The same summary is also printed in the terminal.

---

## How to read the report

### Day desk / Swing desk sections

| Line | Meaning |
|------|---------|
| **Ledger rows (total)** | All scheduled ledger captures (qualified + shadow) |
| **Qualified (trade-ready)** | Passed ledger gates — these are real validation entries |
| **Shadow (audit only)** | Evaluated but failed a gate — saved for study, not a live trade signal |
| **Decision actionable** | Composite decision was actionable |
| **Decision monitor** | Watch / neutral — not ready to act |
| **Decision blocked** | Failed gates or blocked direction |
| **Unique symbols** | How many tickers were evaluated |

### Tracking & gate failures section (per desk)

| Line | Meaning |
|------|---------|
| **Symbols tracked (unique)** | Distinct tickers the ledger job evaluated in the window |
| **Capture attempts (rows)** | Total rows written (qualified + shadow); can exceed unique symbols if multiple captures |
| **Qualified symbols** | Tickers with at least one qualified row |
| **Shadow-only symbols** | Evaluated but never qualified in this window |
| **Shadow rows with gate JSON** | Shadow rows that include `gate_status_json` (usable for diagnosis) |
| **Primary blocker** | First gate that failed on each shadow row (plain English) |
| **Failed gates (audit counts)** | How often each gate failed; one row can increment several gates |
| **Per-symbol primary blocker** | Quick lookup: why each shadow symbol did not qualify |

Common primary blockers:

- **Decision state: was monitor/blocked, need actionable** — composite was not trade-ready (most common).
- **Decision score below minimum 72** — composite strength too low.
- **Layer alignment below minimum 0.52** — too many layers disagree.
- **Risk / reward below minimum** — day needs **1.3:1**, swing needs **2.0:1** (or higher in stressed markets).
- **Sector gate** — sector analyzer score below **45** (swing).
- **Market environment** — VIX / tier policy blocked entry.

### Watchlist maturation section

Separate from ledger: how many watchlist rows are in **actionable** maturation state that day.  
Useful to compare “watchlist says actionable” vs “ledger qualified.”

### Quick health check

- On a **weekday**, if **qualified = 0** for both desks, check that capture ran (CloudWatch / after 4 PM ET).
- A few **shadow** rows with **zero qualified** is normal when gates are strict.
- **Swing qualified** may be **0** for long stretches if sector/macro/R:R gates fail — shadow rows still prove the job ran.

---

## What “actionable” means (two different places)

1. **Ledger qualified** — passed all validation gates at capture time; `ledger_qualified=true` in SignalHistory.
2. **Decision actionable** — composite `decision_state` was actionable (may still fail a later gate).

For “how many signals did we produce for customers to act on,” use **Qualified (trade-ready)** per desk.

---

## If the dev login page breaks (unrelated but common)

Stale Next.js cache can break `/login` static files. From `frontend/`:

```powershell
npm run dev:3002
```

Or: `npm run clean:next` then `npm run dev -- -p 3002`

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| `No SignalHistory table resolved` | Set `DYNAMODB_SIGNAL_HISTORY_TABLE=SignalHistory` |
| All counts zero on a weekday | Wait until after 4:15 PM ET; re-run with `--date` for that day |
| Script slow | Normal — full table scan; typically 1–3 minutes |
| Want per-user rows too | Add `--include-user-rows` (will double-count vs PUBLIC mirror) |

---

## Optional: weight-optimizer readiness (different question)

To see if you have enough **resolved** signals for tuning (not the same as daily ledger counts):

```powershell
python scripts/signal_history_readiness.py --since-days 90
```

---

## Suggested routine (copy to your calendar)

**Mon–Fri 4:20 PM ET** — run daily report  
**Monday 9:00 AM ET** — run weekly report  
**1st of month** — run monthly report for prior month  

Keep the `reports/ledger/` folder; compare week-over-week qualified counts for day vs swing.

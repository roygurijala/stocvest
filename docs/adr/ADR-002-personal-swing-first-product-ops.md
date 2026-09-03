# ADR-002 — Personal swing-first product shell + ops hardening

**Status:** Accepted — **OPS-1 + OPS-2 + VAL-1 done (2026-09-03)**  
**Date:** 2026-09-02  
**Authors:** Product + engineering (user-agreed personal-only direction; Danelfin UX review; production outage post-mortem)  
**Supersedes / relates:** ADR-001 (de-Benzinga complete); does **not** change six-layer math contracts unless a phase explicitly says so.

## Context

Three threads converged in Sep 2026:

1. **Product direction ([Danelfin.com review](https://danelfin.com))** — User prefers Danelfin’s *information design* (ranked table → symbol page → portfolio alerts) over STOCVEST’s full terminal surface. User is considering **personal-only** use (validate the engine on a real book, not public launch).

2. **Trust gap (alert emails)** — Sample swing alerts (NVDQ, EVC, UPWK) showed **tight stops** (~2–3% risk), **inflated headline R/R** (T2-driven), and names unsuitable for swing holds. Partial fixes landed in code (wider swing ATR *k*, T1-only swing R/R, geometry tradeability gate, richer email rows) but **merge policy and product filters remain incomplete**.

3. **Production outage (2026-09-02)** — API Gateway returned **503** for health and composite. Root cause: AWS account **Lambda concurrent execution limit = 10** (not 1000). **`news_consumer`** saturated all slots draining **`stocvest-news-triage-queue`** (~545 visible messages). Background EventBridge jobs compounded throttling (~150–280 throttles/min). Emergency mitigations applied live (disable news_consumer ESM, disable schedulers, quota increase requested). **Not caused by ADR-001 logic.**

## Decision

Ship the next era **one phase at a time**, same discipline as ADR-001:

| Lane | Goal |
|------|------|
| **OPS** | Restore reliable user-facing API under current account limits; prevent recurrence |
| **GEO** | Swing risk geometry that matches hold period — survivable stops, honest R/R, filtered alerts |
| **UX** | Danelfin-*shaped* personal shell; keep STOCVEST engine + gates under the hood |
| **VAL** | Personal validation loop: ranked list → email when truly tradable → ledger proof |

**North star (personal product):**

> Every day: a **ranked list of swing setups I trust**, with clear **why / not-tradable**, **email only when qualified**, and a **ledger** that proves whether it worked.

## Consequences

- **Positive:** Focused personal workflow; fewer false alerts; API stability; Danelfin clarity without black-box scoring.
- **Negative:** Background jobs (desk batch, warmers, news ingestion) stay throttled until OPS phases complete; public/marketing surfaces intentionally deprioritized.
- **Neutral:** Day desk remains in codebase but is **non-primary** for personal mode.

---

## Implementation phases (one at a time)

Each phase ships with **tests**, **CONTEXT/BACKLOG update**, and user **“go ahead”** before the next phase starts.

| Phase | ID | Scope | Status |
|-------|-----|--------|--------|
| 0 | **OPS-0** | **Incident stabilization** — disable `news_consumer` ESM; disable high-frequency EventBridge rules; disable EventBridge Scheduler jobs; request Lambda concurrency quota → **1000** | **DONE 2026-09-03** — quota approved; mitigations reversed via OPS-2 |
| 1 | **OPS-1** | **Terraform: concurrency guards** — `MaximumConcurrency` on `news_consumer` SQS mapping (e.g. **2**); document account quota requirement in `infra/README.md`; optional: reduce `gap-intel-cache-tick` from `rate(2 minutes)` → `rate(5 minutes)` or move off `signals` Lambda | **DONE 2026-09-02** — `news_pipeline.tf`, `variables.tf`, `eventbridge.tf`, `infra/README.md` |
| 2 | **OPS-2** | **Re-enable background jobs safely** — after quota approved: re-enable schedulers in dependency order; re-enable `news_consumer` ESM; runbook + CloudWatch alarm on account `ConcurrentExecutions` ≥ 80% and `Throttles` | **DONE 2026-09-03** — `terraform.tfvars`, `lambda_concurrency_alarms.tf`, `enable_scheduler_jobs.py`, `verify_lambda_concurrency_quota.py` |
| 3 | **GEO-1** | **Swing stop merge policy v2** — swing always uses wider stop; day widens to ATR when structure too tight, otherwise allows tighter ATR band; fixtures on NVDQ/EVC/UPWK-style names | **DONE 2026-09-02** — `reference_stop_policy.py`, `reference-stop-resolve.ts`, tests |
| 4 | **GEO-2** | **Swing alert + desk filters** — exclude leveraged/inverse/single-stock inverse ETFs from swing **execution-actionable** emails and desk discovery; document in `SIGNAL_ENGINE.md` | **DONE 2026-09-02** — `swing_universe_filter.py`, `geometry_tradeability.py`, tests |
| 5 | **GEO-3** | **Email + deep-dive honesty pass** — always show stop distance (ATR + %), **T1 R/R** vs **plan R/R (T2)** separately; suppress or downgrade when `stop_too_tight_for_swing`; Vitest on email template rows | **DONE 2026-09-02** — email rows + `geometry-honesty-present.ts`, `GeometryHonestyPanel` in `deep-dive.tsx` |
| 6 | **UX-1** | ~~Personal mode shell~~ | **SUPERSEDED 2026-09-02** — removed; main app keeps full nav + plan-based desks |
| 7 | **UX-2** | **Market swing setups table on dashboard brief** — Symbol \| Readiness \| Direction \| R/R \| State \| Why from cached swing desk scan (not watchlist); embedded in market brief | **DONE 2026-09-02** — `personal-ranked-home-present.ts`, `market-brief.tsx` |
| 8 | **UX-3** | **Symbol one-page** — consolidate Setup/Layers/Evolution/Chart into a single scroll on `/dashboard` deep dive | **DONE 2026-09-02** — `deep-dive.tsx` one-page sections |
| 9 | **VAL-1** | **Personal validation loop** — document daily workflow in CONTEXT; tighten email prefs to **execution-actionable-only** + geometry gates; weekly `ledger_signal_report.py` review checklist | **DONE 2026-09-03** — `docs/VALIDATION_LOOP.md`, alert pref defaults, weekly report section |
| 10 | **DBZ-9** | *(Optional)* **Retire day Benzinga entirely** — remove `STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED` path; day desk Polygon-only always | Pending (ADR-001 left day flag for optional legacy) |

---

## Phase contracts (additive detail)

### OPS-0 contract (incident)

- **Symptom:** `GET /v1/health` → 503; BFF “signal service temporarily unavailable”; direct Lambda invoke → `ConcurrentInvocationLimitExceeded`.
- **Account fact:** `ConcurrentExecutions` quota = **10**; reserved concurrency **cannot** be set (AWS requires ≥10 unreserved).
- **Live mitigations (2026-09-02):**
  - `news_consumer` event source mapping **Disabled**
  - EventBridge rules `stocvest-gap-intel-cache-tick`, `stocvest-signal-resolution` **Disabled**
  - All EventBridge **Scheduler** jobs **Disabled** (via `scripts/disable_scheduler_jobs.py`)
  - Service quota increase to **1000** requested (`CASE_OPENED`)
- **Do not re-enable** until OPS-1 + OPS-2 complete. **OPS-2 applied 2026-09-03** after quota approval.

### OPS-1 contract

- Terraform `aws_lambda_event_source_mapping.news_consumer_sqs` adds `scaling_config { maximum_concurrency = 2 }` (or variable).
- Document in `infra/README.md`: **minimum recommended account concurrency = 100** for development with full scheduler set.
- CI/terraform validate unchanged.

### OPS-2 contract

- Re-enable order: (1) quota confirmed ≥100, (2) `news_consumer` with cap, (3) low-frequency EventBridge rules, (4) scheduler jobs, (5) gap-intel tick last.
- CloudWatch alarms: account `ConcurrentExecutions` ≥ 80% of quota for 5 min; `Throttles` Sum ≥ 1 per 5 min → SNS alert-email topic.
- Scripts: `scripts/verify_lambda_concurrency_quota.py`, `scripts/enable_scheduler_jobs.py` (mirror of OPS-0 disable script).

### GEO-1 contract

- **Swing** (long): merged stop = **lower price** (wider cushion) = `min(structural, atr_stop)`; then `_apply_min_stop_distance` enforces `max(1.5×ATR, 6% entry)`.
- **Day** (long): widen to ATR when structural is tighter than ATR band; when structure is already wide, allow tighter ATR band (`max(structural, atr_stop)`).
- Bearish mirrors with higher price = wider.
- Tests: EVC/NVDQ/UPWK-style fixtures; Vitest parity in `reference-stop-resolve.ts`.

### GEO-2 contract

- Universe exclusion or execution-actionable block for known inverse/leveraged patterns (e.g. suffix heuristics + curated list: `NVDQ`, `SQQQ`, …).
- No change to raw composite scoring for research; **surface and email** only.

### GEO-3 contract

- Email rows: `Stop distance`, `T1 risk/reward`, optional `Plan R/R (T2)` with label when T2-only promotion would have applied.
- Deep-dive Setup shows the same rows via **Geometry honesty** panel (`geometry-honesty-present.ts`); prominent caution when `stop_too_tight_for_swing` or degenerate geometry.

### UX-1 contract

- ~~Personal mode env gate~~ **Removed 2026-09-02** — swing market table ships on the main dashboard for all users; nav and desk surfaces follow subscription/plan as before.

### UX-2 contract

- Ranked table is **read-mostly** from swing desk cache (`discovery` + `quiet_leaders`); **excludes watchlist-only symbols**.
- Embedded in market brief (center column), not a replacement home layout.
- Columns documented in `API_CONTRACTS.md` when wire shape stabilizes.

### UX-3 contract

- Deep dive is a **single scroll**: Setup → Layers → Evolution → Chart (no tab switching).
- Reuses existing composite fetch and panel components; no new API for v1.

### VAL-1 contract

- Success metric: **≤ 5 execution-actionable emails per week**, each passing GEO gates; ledger rows tracked in `ledger_signal_report.py`.
- Runbook: **`docs/VALIDATION_LOOP.md`** (daily desk workflow, email prefs, weekly checklist).
- Email defaults: only **`on_execution_actionable`** (+ optional PDT) on for new users; noisy types off.
- Weekly report adds **VAL-1 checklist** section with execution email counts from Alerts history.

---

## What we explicitly do **not** copy from Danelfin

- Single opaque **AI Score 1–10**
- **Performance marketing** / backtested return claims on landing
- Collapsing six layers into one vendor black box
- Their data vendor stack

## Technology stance (unchanged from review)

| Keep | Trim (personal mode) |
|------|---------------------|
| Python composite engine | Public landing / founding members |
| Polygon + EDGAR + Finnhub/FMP | Heavy admin hub |
| Next.js + BFF | Scanner/gap as primary nav |
| DynamoDB ledger / watchlist / alerts | Dual day/swing parity in UI |
| Lambda + Terraform (after OPS fix) | Benzinga optional paths |

---

## References

- ADR-001 — [`ADR-001-swing-polygon-primary-debenzinga.md`](./ADR-001-swing-polygon-primary-debenzinga.md)
- Danelfin UX review — agent transcript 2026-09-01
- Outage notes — 2026-09-02 (`news_consumer` queue depth, concurrency 10)
- `stocvest/api/services/reference_stop_policy.py`
- `stocvest/api/services/geometry_tradeability.py`
- `stocvest/services/email_service.py`
- `infra/news_pipeline.tf`, `infra/eventbridge.tf`, `infra/eventbridge_scheduler_6g.tf`
- `scripts/disable_scheduler_jobs.py` (emergency ops; not a permanent product surface)
- `scripts/enable_scheduler_jobs.py` (OPS-2 re-enable mirror)
- `scripts/verify_lambda_concurrency_quota.py` (OPS-2 preflight)

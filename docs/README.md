# STOCVEST documentation index

Use this map to find the right doc quickly. **Authoritative technical specs** live in focused files; **session / ops narrative** is intentionally consolidated so we do not duplicate long-running text in three places.

| Document | Purpose |
|----------|---------|
| [`CONTEXT.md`](./CONTEXT.md) | Session context, ops checklist, test baselines, legal/session rules. **Single narrative log** for “where we are today.” |
| [`BACKLOG.md`](./BACKLOG.md) | Planned work only (IDs, priority). Shipped items move to `IMPLEMENTED.md`. |
| [`IMPLEMENTED.md`](./IMPLEMENTED.md) | Shipped work archive (stable IDs for PRs/commits). |
| [`PERFORMANCE.md`](./PERFORMANCE.md) | Performance architecture, tiers, invariants — **source of truth** for latency, prefetch, caching, streaming. |
| [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md) | **Dashboard + terminal-grade UX**: IA direction, click hierarchy, SLOs, phased delivery, assistant contract — aligned with current **dark theme** (mockups are reference only). Includes **scanner quiet-day** section roles (B49) and the **§9 Trading Room redesign** now live on `/dashboard` (B63). |
| [`OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md`](./OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md) | **Opportunity Desk (D13):** full-market funnel, tiered refresh, dashboard sentiment/discovery/**quiet leaders**/watchlist radar, watchlist scanner reserve — phased plan + acceptance criteria (Phases 0–7). |
| [`API_CONTRACTS.md`](./API_CONTRACTS.md) | HTTP API contracts. |
| [`SIGNAL_ENGINE.md`](./SIGNAL_ENGINE.md) | Signal engine reference. |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Deploy / infra notes (incl. **Lambda Linux packaging** — `scripts/build_lambda_package.ps1`). |
| [`TUNING_PLAYBOOK.md`](./TUNING_PLAYBOOK.md) | Tuning parameters playbook. |
| [`LEDGER_DAILY_VERIFICATION.md`](./LEDGER_DAILY_VERIFICATION.md) | **Daily / weekly / monthly** ledger signal counts (day vs swing, qualified vs shadow, actionable) — commands + saved reports under `reports/ledger/`. |
| [`D1_SIGNAL_RESOLUTION_SCHEDULE.md`](./D1_SIGNAL_RESOLUTION_SCHEDULE.md) | D1 resolution schedule. |
| [`CURSOR_RULES.md`](./CURSOR_RULES.md) | Cursor / editor rules for contributors. |

**Cleanup rule:** Prefer adding a short pointer here or in `BACKLOG.md` rather than pasting the same paragraph into `CONTEXT.md` and `PERFORMANCE.md`.

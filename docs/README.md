# STOCVEST documentation index

Use this map to find the right doc quickly. **Authoritative technical specs** live in focused files; **session / ops narrative** is intentionally consolidated so we do not duplicate long-running text in three places.

| Document | Purpose |
|----------|---------|
| [`CONTEXT.md`](./CONTEXT.md) | Session context, ops checklist, test baselines, legal/session rules. **Single narrative log** for “where we are today.” |
| [`BACKLOG.md`](./BACKLOG.md) | Planned work only (IDs, priority). Shipped items move to `IMPLEMENTED.md`. |
| [`IMPLEMENTED.md`](./IMPLEMENTED.md) | Shipped work archive (stable IDs for PRs/commits). |
| [`PERFORMANCE.md`](./PERFORMANCE.md) | Performance architecture, tiers, invariants — **source of truth** for latency, prefetch, caching, streaming. |
| [`DASHBOARD_TERMINAL_UX_PLAN.md`](./DASHBOARD_TERMINAL_UX_PLAN.md) | **Dashboard + terminal-grade UX**: IA direction, click hierarchy, SLOs, phased delivery, assistant contract — aligned with current **dark theme** (mockups are reference only). |
| [`API_CONTRACTS.md`](./API_CONTRACTS.md) | HTTP API contracts. |
| [`SIGNAL_ENGINE.md`](./SIGNAL_ENGINE.md) | Signal engine reference. |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Deploy / infra notes. |
| [`TUNING_PLAYBOOK.md`](./TUNING_PLAYBOOK.md) | Tuning parameters playbook. |
| [`D1_SIGNAL_RESOLUTION_SCHEDULE.md`](./D1_SIGNAL_RESOLUTION_SCHEDULE.md) | D1 resolution schedule. |
| [`CURSOR_RULES.md`](./CURSOR_RULES.md) | Cursor / editor rules for contributors. |

**Cleanup rule:** Prefer adding a short pointer here or in `BACKLOG.md` rather than pasting the same paragraph into `CONTEXT.md` and `PERFORMANCE.md`.

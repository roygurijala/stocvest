# STOCVEST — Cursor AI rules

**Canonical rules live in the repository root file [`.cursorrules`](../.cursorrules).** Cursor loads that file automatically for AI agents; edit **`.cursorrules`** when changing project-wide AI guidance.

This page exists so people browsing `docs/` know where the rules are. **Do not maintain a second full copy of the rules here** — it will drift.

## Quick pointers

- Start every session: **`docs/CONTEXT.md`** (and **`docs/BACKLOG.md`** for planned work).
- Contracts: **`docs/API_CONTRACTS.md`** — change only with explicit instruction (a user directive to refresh all `.md` files counts as coordinated contract documentation when implementations already exist). Composite **`layers[]`** sector objects: optional additive **`sic_mapping_tier`** (`exact` \| `prefix` \| `coarse` \| `fallback_spy`) is documented in **§4.3** and **`docs/SIGNAL_ENGINE.md`** § Sector.
- Test baselines: **`docs/CONTEXT.md` §13**.
- Dashboard **InfoTip** / card tooltip strings: **`frontend/lib/ui-tooltips.ts`** (prefer plain-language explanations; see **`docs/CONTEXT.md` §2** **Frontend** and **B25** in **`docs/BACKLOG.md`**).

# Watchlist maturation — architecture (Part 0)

**Status:** initial implementation slice (2026-05-15). Supplements `docs/WATCHLIST_PIPELINE_IMPLEMENTATION_PROMPT.md`.

## Decisions (v1)

1. **List model:** Keep existing **`Watchlists`** table for user-owned lists (default list drives scanner). New **`WatchlistMaturation`** Dynamo table stores **per-(user, symbol, mode)** engine state only. Repository will join default-list membership to maturation rows in a later part.

2. **Table strategy:** **New table** alongside `Watchlists` (no destructive migration in this slice). Terraform: `aws_dynamodb_table.watchlist_maturation`.

3. **Primary keys (items):**
   - `pk` = `USER#{user_id}`
   - `sk` = `SYM#{SYMBOL}#{mode}` (`mode` ∈ `swing` | `day`)

4. **GSI — `UserStateIndex`:** projected attributes `gsi1pk` = `USER#{user_id}`, `gsi1sk` = `STATE#{state}#SYM#{SYMBOL}#MODE#{mode}` for “all actionable for user” style queries. Helper: `stocvest.models.watchlist.user_state_gsi_keys`.

5. **Session refresh (per user):** Opening **Dashboard** or the default **Watchlists** list triggers a background refresh for symbols whose ``last_evaluated_at`` is before **today’s America/New_York calendar date** (see ``frontend/lib/watchlist-maturation-session-staleness.ts`` and ``watchlist-maturation-session-refresh.ts``). Uses the same composite + ``sync_watchlist_maturation_from_composite`` path as row **Refresh** / **Evidence**. **Manual:** row **Refresh** and **Evidence** unchanged.

   **Scheduler (maturation batch — removed):** EventBridge ``maturation_refresh*`` schedules were removed; the scanner handler returns ``batch_maturation_refresh_disabled`` if invoked. Worker ``watchlist_maturation_refresh.py`` remains for tests/reference only.

   **Scheduler (other):** ``ledger_capture`` — **~3:55 PM** — validation **ledger gate capture** (unchanged). See ``stocvest.workers.watchlist_ledger_capture``.

6. **State-change email (evidence only):** When a user’s default-watchlist symbol’s maturation **state** changes after a successful dual-write from **View Evidence** (not from the scheduler job), SES may fire if ``AlertPreferences`` allow it. Dedupe: same **America/New_York** calendar day **and** the same **(mode, previous_state, new_state)** tuple as a prior sent row’s JSON body (``had_watchlist_maturation_transition_on_et_calendar_day``); different transitions the same day can each email once. Broader helpers remain in ``alert_store.py``. Default **Watchlists** page surfaces recent maturation email rows via **`GET /v1/alerts/history`** with **`alert_type=watchlist_maturation`** and **`symbols=<default list tickers>`** (see **`docs/API_CONTRACTS.md` §4.14**).

7. **TTL:** Attribute `ttl` (Unix epoch) enabled on the table for physical cleanup of invalidated / archived rows. `archive_after` remains ISO string for UX “hide from active list” before TTL deletes.

8. **Setup evolution log (2026-05-16, analytics B46 2026-05-17):** Table **`WatchlistMaturationTransition`** stores append-only rows when maturation **state** changes or **alignment** meaningfully changes (layer count, missing set, or bias). Keys: `pk` = `USER#{user_id}#SYM#{SYMBOL}#MODE#{mode}`, `sk` = `TS#{recorded_at_iso}`; GSI **`ModeTimelineIndex`** (`gsi1pk` = `MODE#swing|day`, `gsi1sk` = `{recorded_at}#{user_id}#{symbol}`) for platform aggregates. Optional **`price_at_event`** on new rows. TTL **90 days**. APIs: per-symbol **`GET /v1/watchlists/symbols/{symbol}/setup-evolution`**, user outcomes **`GET /v1/analytics/setup-outcomes`**, admin **`GET /v1/admin/system-behavior`**. UI: `/dashboard/setup-evolution`, `/dashboard/setup-outcomes` — see **`SETUP_ANALYTICS_SPEC.md`**.

## Related code

- Existing lists: `stocvest/data/watchlist_store.py`
- Scanner universe: `stocvest/data/scan_symbols.py`
- Model: `stocvest/models/watchlist.py` (`MATURATION_LAYER_KEYS` matches composite `layers[].layer`)
- Maturation Dynamo I/O: `stocvest/data/watchlist_maturation_repository.py`
- **Dual-write (evidence):** after a successful composite compute (not cache), `stocvest/api/services/watchlist_maturation_sync.py` upserts a row when the table env is set and the symbol is on the user’s **default** watchlist (`composite_response_with_evidence_cache` in `stocvest/api/handlers/signals.py`).
- **Scheduled refresh:** ``stocvest/workers/watchlist_maturation_refresh.py`` (``scan_type=maturation_refresh*`` on scanner Lambda; see ``infra/eventbridge_scheduler_6g.tf``).
- **Scheduled ledger capture (B62):** ``stocvest/workers/watchlist_ledger_capture.py`` (``scan_type=ledger_capture`` at **3:55 PM ET**; optional ``ledger_capture_day`` / ``ledger_capture_swing``). Persists gate attempts to **`SignalHistory`**; does not update maturation rows.

## UI and BFF (watchlists page)

- **API:** ``GET /v1/watchlists/maturation-summary`` (query ``mode=day`` or ``swing``) returns ``by_symbol`` keyed by uppercase symbol. Each value includes at least ``state``; the handler also projects **``readiness_label``** and **``label``** from the user’s watchlist entry when present.
- **Next.js BFF:** ``frontend/app/api/stocvest/watchlists/maturation-summary/route.ts`` forwards the authenticated request to the backend.
- **Dashboard watchlists:** ``frontend/app/dashboard/watchlists/page.tsx`` resolves ``maturationSummaryMode`` (**``day``** vs **``swing``**) from the same subscription rule as scanner load (**``scannerSetupLoadModeForSubscription``** — Swing Pro uses swing; Swing+Day / free use day). ``frontend/components/watchlists-page-client.tsx`` loads maturation **only when the active list is the default watchlist** and there is at least one symbol; shows **Loading maturation…** / **Maturation unavailable** in the symbols header; explains on non-default lists that maturation is default-only. Under each symbol’s **Signals** link: readiness → label → humanized state; default-only fallback **“Not evaluated yet”** when there is no row. Non-default lists do not call this endpoint; maturation state is cleared when switching away from the default list.
- **Watchlist page UX (list chrome):** One sticky **add + search** control (Signals-style typeahead for new tickers, merged with on-list matches). Symbol lists are **deduped** (uppercase, first occurrence wins) in the client and when hydrating from Dynamo (**``WatchlistItem.from_item``**). **Search** filters visible rows and scopes maturation text to the active desk (**Swing** / **Day**); in **Both** dual-desk maturation view, search matches **ticker + company name** only (no cross-desk maturation substring match). Row **quotes** load via authenticated batch **`GET /api/stocvest/market/snapshots`** (BFF → **`GET /v1/market/snapshots`**). Pure helpers for filters, labels, and quote formatting live in **`frontend/lib/watchlist-page-utils.ts`** (unit-tested).
- **Plan gate (API):** ``GET /v1/watchlists/maturation-summary`` omits **``readiness_label``** for users on the **free** plan unless **``beta_access_active``**; **``swing_pro``** and **``swing_day_pro``** receive the full object. Logic: ``stocvest/api/services/watchlist_maturation_gates.py``; handler: ``watchlists_maturation_summary_handler``.
- **Scanner load:** ``frontend/lib/api/scanner-load.ts`` may request the same summary to merge maturation into dashboard status (see ``buildWatchlistDashboardStatus``). Stable HTTP contract: ``docs/API_CONTRACTS.md`` §**4.13**.
- **Signals deep links:** ``frontend/lib/nav/watchlist-signals-deeplink.ts`` builds **``/dashboard/signals?ref=watchlist&symbol=…``** (optional **``trading_mode``**). Used on the Watchlists page for the maturation email strip (ticker links + per-symbol **Signals** row link, with **``trading_mode``** = **``maturationSummaryMode``**) and on **Settings → Recent Alerts** for any row with a ticker (**``trading_mode``** omitted so the Signals client keeps its usual default). Ticker links carry an **``aria-label``** (e.g. “Open AAPL on Signals”).

## Evaluation vs presentation (`symbol_tracking`)

**Engine (system truth):** Scheduled maturation refresh, evidence dual-write, and composite/signal generation **always** evaluate swing and day for symbols on the default watchlist. **`symbol_tracking` must not gate** refresh eligibility or Dynamo upserts.

**Presentation (user lens):** Per-symbol **`symbol_tracking`** on the default watchlist (`{ swing, day }`, persisted via **`PATCH …/symbols/{symbol}/tracking`**) affects:

- **UI:** hide desk rows when unchecked; sort/status counts use **tracked desks only** (`frontend/lib/watchlist-tracking-presentation.ts`).
- **Alerts:** maturation emails suppressed for untracked desks (`stocvest/api/services/watchlist_tracking_prefs.py` + `AlertTriggerService.trigger_watchlist_maturation_change`).
- **Dashboard strip:** `scanner-load` merges swing+day maturation then applies the tracking lens for `buildWatchlistDashboardStatus`.

Re-enabling a desk surfaces existing maturation state without re-running evaluation.

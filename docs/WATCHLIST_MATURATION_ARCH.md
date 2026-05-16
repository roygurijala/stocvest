# Watchlist maturation — architecture (Part 0)

**Status:** initial implementation slice (2026-05-15). Supplements `docs/WATCHLIST_PIPELINE_IMPLEMENTATION_PROMPT.md`.

## Decisions (v1)

1. **List model:** Keep existing **`Watchlists`** table for user-owned lists (default list drives scanner). New **`WatchlistMaturation`** Dynamo table stores **per-(user, symbol, mode)** engine state only. Repository will join default-list membership to maturation rows in a later part.

2. **Table strategy:** **New table** alongside `Watchlists` (no destructive migration in this slice). Terraform: `aws_dynamodb_table.watchlist_maturation`.

3. **Primary keys (items):**
   - `pk` = `USER#{user_id}`
   - `sk` = `SYM#{SYMBOL}#{mode}` (`mode` ∈ `swing` | `day`)

4. **GSI — `UserStateIndex`:** projected attributes `gsi1pk` = `USER#{user_id}`, `gsi1sk` = `STATE#{state}#SYM#{SYMBOL}#MODE#{mode}` for “all actionable for user” style queries. Helper: `stocvest.models.watchlist.user_state_gsi_keys`.

5. **Scheduler / stale eval:** EventBridge Scheduler invokes the **scanner** Lambda with ``scan_type=maturation_refresh`` (Mon–Fri ~4:30 PM America/New_York after cash close). The job scans default watchlists and runs bounded day composites → ``sync_watchlist_maturation_from_composite`` (optional swing via ``STOCVEST_MATURATION_REFRESH_SWING``). Caps: ``STOCVEST_MATURATION_REFRESH_MAX_USERS``, ``_MAX_SYMBOLS_PER_USER``, ``_MAX_CALLS`` env vars. No hot ``mode``-partition GSI. The refresh path passes ``email_on_state_change=False`` so scheduled runs do not send maturation emails.

6. **State-change email (evidence only):** When a user’s default-watchlist symbol’s maturation **state** changes after a successful dual-write from **View Evidence** (not from the scheduler job), SES may fire if ``AlertPreferences`` allow it. Dedupe: same **America/New_York** calendar day **and** the same **(mode, previous_state, new_state)** tuple as a prior sent row’s JSON body (``had_watchlist_maturation_transition_on_et_calendar_day``); different transitions the same day can each email once. Broader helpers remain in ``alert_store.py``. Default **Watchlists** page surfaces recent maturation email rows via **`GET /v1/alerts/history`** with **`alert_type=watchlist_maturation`** and **`symbols=<default list tickers>`** (see **`docs/API_CONTRACTS.md` §4.14**).

7. **TTL:** Attribute `ttl` (Unix epoch) enabled on the table for physical cleanup of invalidated / archived rows. `archive_after` remains ISO string for UX “hide from active list” before TTL deletes.

## Related code

- Existing lists: `stocvest/data/watchlist_store.py`
- Scanner universe: `stocvest/data/scan_symbols.py`
- Model: `stocvest/models/watchlist.py` (`MATURATION_LAYER_KEYS` matches composite `layers[].layer`)
- Maturation Dynamo I/O: `stocvest/data/watchlist_maturation_repository.py`
- **Dual-write (evidence):** after a successful composite compute (not cache), `stocvest/api/services/watchlist_maturation_sync.py` upserts a row when the table env is set and the symbol is on the user’s **default** watchlist (`composite_response_with_evidence_cache` in `stocvest/api/handlers/signals.py`).
- **Scheduled refresh:** ``stocvest/workers/watchlist_maturation_refresh.py`` (``scan_type=maturation_refresh`` on scanner Lambda; see ``infra/eventbridge_scheduler_6g.tf``).

## UI and BFF (watchlists page)

- **API:** ``GET /v1/watchlists/maturation-summary`` (query ``mode=day`` or ``swing``) returns ``by_symbol`` keyed by uppercase symbol. Each value includes at least ``state``; the handler also projects **``readiness_label``** and **``label``** from the user’s watchlist entry when present.
- **Next.js BFF:** ``frontend/app/api/stocvest/watchlists/maturation-summary/route.ts`` forwards the authenticated request to the backend.
- **Dashboard watchlists:** ``frontend/app/dashboard/watchlists/page.tsx`` resolves ``maturationSummaryMode`` (**``day``** vs **``swing``**) from the same subscription rule as scanner load (**``scannerSetupLoadModeForSubscription``** — Swing Pro uses swing; Swing+Day / free use day). ``frontend/components/watchlists-page-client.tsx`` loads maturation **only when the active list is the default watchlist** and there is at least one symbol; shows **Loading maturation…** / **Maturation unavailable** in the symbols header; explains on non-default lists that maturation is default-only. Under each symbol’s **Signals** link: readiness → label → humanized state; default-only fallback **“Not evaluated yet”** when there is no row. Non-default lists do not call this endpoint; maturation state is cleared when switching away from the default list.
- **Watchlist page UX (list chrome):** One sticky **add + search** control (Signals-style typeahead for new tickers, merged with on-list matches). Symbol lists are **deduped** (uppercase, first occurrence wins) in the client and when hydrating from Dynamo (**``WatchlistItem.from_item``**). **Search** filters visible rows and scopes maturation text to the active desk (**Swing** / **Day**); in **Both** dual-desk maturation view, search matches **ticker + company name** only (no cross-desk maturation substring match). Row **quotes** load via authenticated batch **`GET /api/stocvest/market/snapshots`** (BFF → **`GET /v1/market/snapshots`**). Pure helpers for filters, labels, and quote formatting live in **`frontend/lib/watchlist-page-utils.ts`** (unit-tested).
- **Plan gate (API):** ``GET /v1/watchlists/maturation-summary`` omits **``readiness_label``** for users on the **free** plan unless **``beta_access_active``**; **``swing_pro``** and **``swing_day_pro``** receive the full object. Logic: ``stocvest/api/services/watchlist_maturation_gates.py``; handler: ``watchlists_maturation_summary_handler``.
- **Scanner load:** ``frontend/lib/api/scanner-load.ts`` may request the same summary to merge maturation into dashboard status (see ``buildWatchlistDashboardStatus``). Stable HTTP contract: ``docs/API_CONTRACTS.md`` §**4.13**.
- **Signals deep links:** ``frontend/lib/nav/watchlist-signals-deeplink.ts`` builds **``/dashboard/signals?ref=watchlist&symbol=…``** (optional **``trading_mode``**). Used on the Watchlists page for the maturation email strip (ticker links + per-symbol **Signals** row link, with **``trading_mode``** = **``maturationSummaryMode``**) and on **Settings → Recent Alerts** for any row with a ticker (**``trading_mode``** omitted so the Signals client keeps its usual default). Ticker links carry an **``aria-label``** (e.g. “Open AAPL on Signals”).

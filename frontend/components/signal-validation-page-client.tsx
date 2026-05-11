"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchUserSignalHistoryPage,
  type PublicSignal,
  type UserSignalHistoryPageSize
} from "@/lib/api/public-signals";
import { CuteLoader } from "@/components/cute-loader";
import { HistoricalValidationPanel } from "@/components/historical-validation-panel";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type LedgerTab = "swing" | "day";

/**
 * Top-level view tabs on the Signal Validation page.
 *
 * - `ledger` — the row-level Tracked Outcomes ledger that this page has always rendered.
 * - `historical` — the D2 Historical Signal Validation Phase 3b aggregate view (six
 *   stratifications over a date-range slice). Lives in `historical-validation-panel.tsx`
 *   so the ledger surface stays untouched and the aggregate surface can evolve on its own.
 */
type ValidationView = "ledger" | "historical";

const PAGE_SIZE_OPTIONS: UserSignalHistoryPageSize[] = [25, 50, 75, 100];

function formatEtLine(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "shortGeneric"
    }).format(d);
  } catch {
    return iso;
  }
}

function layerScoresSummary(scores: Record<string, number> | undefined): string {
  if (!scores || !Object.keys(scores).length) return "—";
  const keys = ["macro", "sector", "technical", "news", "internals", "geopolitical", "geo"];
  const parts: string[] = [];
  for (const k of keys) {
    const v = scores[k] ?? (k === "geopolitical" ? scores.geo : undefined);
    if (v != null && Number.isFinite(v)) {
      const label = k === "geopolitical" ? "geo" : k.slice(0, 3);
      parts.push(`${label} ${Math.round(v)}`);
    }
  }
  if (!parts.length) {
    return Object.entries(scores)
      .slice(0, 4)
      .map(([k, v]) => `${k.slice(0, 3)} ${Math.round(v)}`)
      .join(" · ");
  }
  return parts.join(" · ");
}

function dash(s: string | null | undefined): string {
  return s != null && String(s).trim() !== "" ? String(s) : "—";
}

function nyYmdFromIso(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function gateSummary(gs: PublicSignal["gate_status"]): string {
  if (!gs) return "—";
  if (Array.isArray(gs)) return gs.length ? `list(${gs.length})` : "—";
  const e = Object.entries(gs as Record<string, unknown>).slice(0, 4);
  if (!e.length) return "—";
  return e.map(([k, v]) => `${k}:${String(v).slice(0, 14)}`).join(" · ");
}

function outcomeSymbol(s: PublicSignal, tab: LedgerTab): string {
  const primary = tab === "swing" ? s.outcome_1d : s.outcome_1h;
  const raw = primary || s.outcome;
  if (raw === "correct" || raw === "win") return "+";
  if (raw === "incorrect" || raw === "loss") return "−";
  if (raw === "neutral") return "0";
  if (s.outcome === "pending") return "…";
  return "…";
}

function ledgerMetrics(rows: PublicSignal[], tab: LedgerTab) {
  const n = rows.length;
  const evaluated = rows.filter((r) => {
    if (tab === "swing") return r.resolved_1d === true || (r.outcome_1d != null && r.outcome_1d !== "");
    return r.resolved_1h === true || (r.outcome_1h != null && r.outcome_1h !== "");
  }).length;
  const completed = rows.filter((r) => r.outcome !== "pending").length;
  let plus = 0;
  let minus = 0;
  let zero = 0;
  for (const r of rows) {
    const sym = outcomeSymbol(r, tab);
    if (sym === "+") plus += 1;
    else if (sym === "−") minus += 1;
    else if (sym === "0") zero += 1;
  }
  const ruleResolved = tab === "swing" ? rows.filter((r) => r.resolved_1d).length : rows.filter((r) => r.resolved_1h).length;
  return { n, evaluated, completed, plus, minus, zero, ruleResolved };
}

export function SignalValidationPageClient() {
  const { colors } = useTheme();
  const [view, setView] = useState<ValidationView>("ledger");
  const [tab, setTab] = useState<LedgerTab>("swing");
  const [pageSize, setPageSize] = useState<UserSignalHistoryPageSize>(25);
  const [rows, setRows] = useState<PublicSignal[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Only forward `trading_mode` to the assistant when the user is looking at the ledger
  // view (which is per-mode). The historical view is per-window and uses its own internal
  // mode filter, so leaving `trading_mode` unset there avoids misleading the assistant's
  // page-context routing.
  usePublishAssistantContext(
    view === "ledger"
      ? { page: "dashboard/signal-validation", trading_mode: tab }
      : { page: "dashboard/signal-validation" }
  );

  const loadFirstPage = useCallback(async (t: LedgerTab, ps: UserSignalHistoryPageSize) => {
    setLoading(true);
    const page = await fetchUserSignalHistoryPage({
      mode: t,
      days: 120,
      pageSize: ps,
      ledgerOnly: true
    });
    if (page === null) {
      setRows(null);
      setNextCursor(null);
    } else {
      setRows(page.items);
      setNextCursor(page.next_cursor);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Skip the ledger fetch when the user is on the historical view — saves a network
    // round-trip every time the page mounts in historical mode.
    if (view !== "ledger") return;
    void loadFirstPage(tab, pageSize);
  }, [view, tab, pageSize, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (nextCursor == null || loadingMore || rows == null) {
      return;
    }
    setLoadingMore(true);
    const page = await fetchUserSignalHistoryPage({
      mode: tab,
      days: 120,
      pageSize,
      cursor: nextCursor,
      ledgerOnly: true
    });
    if (page != null) {
      setRows((prev) => (prev == null ? page.items : [...prev, ...page.items]));
      setNextCursor(page.next_cursor);
    }
    setLoadingMore(false);
  }, [nextCursor, loadingMore, rows, tab, pageSize]);

  const metrics = useMemo(() => (rows != null ? ledgerMetrics(rows, tab) : null), [rows, tab]);

  const tabBtn = (id: LedgerTab, label: string) => {
    const on = tab === id;
    return (
      <button
        type="button"
        key={id}
        onClick={() => setTab(id)}
        style={{
          padding: `${spacing[2]}px ${spacing[4]}px`,
          borderRadius: borderRadius.md,
          border: `1px solid ${on ? colors.accent : colors.border}`,
          background: on ? `${colors.accent}18` : colors.surface,
          color: on ? colors.accent : colors.text,
          fontWeight: 600,
          fontSize: typography.scale.sm,
          cursor: "pointer"
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ padding: spacing[6], maxWidth: 1120, margin: "0 auto" }}>
      <header style={{ marginBottom: spacing[6] }}>
        <h1 style={{ margin: 0, fontSize: typography.scale["2xl"], color: colors.text, fontWeight: 700 }}>
          Tracked signal outcomes
        </h1>
        <p
          style={{
            margin: `${spacing[3]}px 0 0`,
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            lineHeight: 1.6,
            maxWidth: 720
          }}
        >
          This page logs historical outcomes of STOCVEST decisions using fixed rules. It is not a managed portfolio,
          recommendation, trading account, or promise of results.           Outcomes are observed for validation and learning —
          not promotion.
        </p>
      </header>

      {/* Top-level view tabs: row-level Ledger vs aggregate Historical Validation. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing[2],
          marginBottom: spacing[5]
        }}
      >
        {([
          ["ledger", "Tracked outcomes (ledger)"],
          ["historical", "Historical accuracy"]
        ] as const).map(([id, label]) => {
          const on = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              data-testid={`signal-validation-view-${id}`}
              style={{
                padding: `${spacing[2]}px ${spacing[4]}px`,
                borderRadius: borderRadius.md,
                border: `1px solid ${on ? colors.accent : colors.border}`,
                background: on ? `${colors.accent}18` : colors.surface,
                color: on ? colors.accent : colors.text,
                fontWeight: 600,
                fontSize: typography.scale.sm,
                cursor: "pointer"
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {view === "historical" ? (
        <HistoricalValidationPanel />
      ) : (
        <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[3],
          marginBottom: spacing[5]
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
          {tabBtn("swing", "Swing (multi-day)")}
          {tabBtn("day", "Day (intraday)")}
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            fontSize: typography.scale.sm,
            color: colors.textMuted
          }}
        >
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as UserSignalHistoryPageSize)}
            style={{
              padding: `${spacing[1]}px ${spacing[2]}px`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontSize: typography.scale.sm
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section
        className={surfaceGlowClassName}
        style={{
          borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`,
          padding: spacing[5],
          marginBottom: spacing[6],
          background: colors.surface
        }}
      >
        <h2 style={{ margin: `0 0 ${spacing[3]}px`, fontSize: typography.scale.lg, color: colors.text }}>
          {tab === "swing" ? "Swing track" : "Day track"}
        </h2>
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.55 }}>
          {tab === "swing"
            ? "Multi-day decisions are evaluated at daily cadence in line with swing gates (structure, regime, sector). Intraday noise is not used to mark the ledger row."
            : "Intraday decisions use session-bound rules (e.g. VWAP, momentum window). Rows reflect discrete evaluation checkpoints, not live execution."}
        </p>
      </section>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: spacing[10] }}>
          <CuteLoader label="Loading ledger…" />
        </div>
      ) : rows === null ? (
        <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Sign in to view your logged signals.</p>
      ) : (
        <>
          {metrics ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: spacing[3],
                  marginBottom: spacing[6]
                }}
              >
                {[
                  ["Signals logged", String(metrics.n)],
                  ["Evaluated checkpoints", String(metrics.evaluated)],
                  ["Outcome settled", String(metrics.completed)],
                  ["Observed + / − / 0", `${metrics.plus} / ${metrics.minus} / ${metrics.zero}`],
                  [tab === "swing" ? "D1 resolved flag" : "1h resolved flag", String(metrics.ruleResolved)]
                ].map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      borderRadius: borderRadius.md,
                      border: `1px solid ${colors.border}`,
                      padding: spacing[3],
                      background: colors.background
                    }}
                  >
                    <div style={{ fontSize: typography.scale.xs, color: colors.textMuted, marginBottom: spacing[1] }}>
                      {k}
                    </div>
                    <div style={{ fontSize: typography.scale.lg, fontWeight: 700, color: colors.text }}>{v}</div>
                  </div>
                ))}
              </div>
              <p style={{ margin: `${spacing[2]}px 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                Summary counts include every row loaded below; use &quot;Load more&quot; to extend the window.
              </p>
            </>
          ) : null}

          <div style={{ overflowX: "auto" }}>
            {tab === "swing" ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
                <thead>
                  <tr style={{ textAlign: "left", color: colors.textMuted, fontSize: typography.scale.xs }}>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Symbol</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Entry date (NY)</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Exit date (NY)</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Decision score</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Entry rationale</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Exit reason</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Observed</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>MAE %</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>MFE %</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Gate snapshot</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Regime @ exit</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Decision @ exit</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Layers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ padding: spacing[4], color: colors.textMuted }}>
                        No rows in this track yet. Only signals that pass logging rules appear here.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const entryD = r.ledger_entry_date_et ?? nyYmdFromIso(r.timestamp_iso);
                      const exitD =
                        r.ledger_exit_date_et ?? (r.closed_at ? nyYmdFromIso(r.closed_at) : "—");
                      const td = { padding: spacing[2], borderBottom: `1px solid ${colors.border}` };
                      return (
                        <tr key={r.signal_id ?? `${r.symbol}-${r.timestamp_iso}`} style={{ color: colors.text }}>
                          <td style={{ ...td, fontWeight: 600 }}>
                            <Link
                              // Mode Separation: validation ledger is per-mode
                              // (swing tab vs day tab), so the deep link must
                              // open Signals in the same engine the user was
                              // reviewing — never silently the other one.
                              href={`/dashboard/signals?symbol=${encodeURIComponent(r.symbol.trim().toUpperCase())}&ref=validation&trading_mode=${tab}`}
                              className="font-semibold no-underline hover:underline"
                              style={{ color: colors.text }}
                            >
                              {r.symbol}
                            </Link>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{dash(entryD)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{dash(exitD)}</td>
                          <td style={td}>{Math.round(r.signal_strength)}</td>
                          <td style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs }}>{dash(r.entry_rationale)}</td>
                          <td style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs }}>{dash(r.exit_reason)}</td>
                          <td style={{ ...td, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                            {outcomeSymbol(r, tab)}
                          </td>
                          <td style={td}>{fmtPct(r.max_adverse_excursion_pct)}</td>
                          <td style={td}>{fmtPct(r.max_favorable_excursion_pct)}</td>
                          <td
                            style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs, color: colors.textMuted }}
                            title={r.gate_status ? JSON.stringify(r.gate_status) : undefined}
                          >
                            {gateSummary(r.gate_status)}
                          </td>
                          <td style={td}>{dash(r.market_regime_exit)}</td>
                          <td style={td}>{dash(r.decision_state_exit)}</td>
                          <td
                            style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs, color: colors.textMuted }}
                            title={r.layer_scores ? JSON.stringify(r.layer_scores) : undefined}
                          >
                            {layerScoresSummary(r.layer_scores)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
                <thead>
                  <tr style={{ textAlign: "left", color: colors.textMuted, fontSize: typography.scale.xs }}>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Symbol</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Entry (ET)</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Exit (ET)</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Decision score</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Setup type</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Exit rule</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Observed</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Hold (min)</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Gate snapshot</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Regime @ exit</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Decision @ exit</th>
                    <th style={{ padding: spacing[2], borderBottom: `1px solid ${colors.border}` }}>Layers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ padding: spacing[4], color: colors.textMuted }}>
                        No rows in this track yet. Only signals that pass logging rules appear here.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const td = { padding: spacing[2], borderBottom: `1px solid ${colors.border}` };
                      const setup = r.setup_type ?? r.pattern;
                      const exitRule = r.exit_rule ?? r.exit_reason;
                      const hold =
                        r.hold_duration_minutes != null && Number.isFinite(r.hold_duration_minutes)
                          ? String(r.hold_duration_minutes)
                          : "—";
                      return (
                        <tr key={r.signal_id ?? `${r.symbol}-${r.timestamp_iso}`} style={{ color: colors.text }}>
                          <td style={{ ...td, fontWeight: 600 }}>
                            <Link
                              // Mode Separation: validation ledger is per-mode
                              // (swing tab vs day tab), so the deep link must
                              // open Signals in the same engine the user was
                              // reviewing — never silently the other one.
                              href={`/dashboard/signals?symbol=${encodeURIComponent(r.symbol.trim().toUpperCase())}&ref=validation&trading_mode=${tab}`}
                              className="font-semibold no-underline hover:underline"
                              style={{ color: colors.text }}
                            >
                              {r.symbol}
                            </Link>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{formatEtLine(r.timestamp_iso)}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {r.closed_at ? formatEtLine(r.closed_at) : "—"}
                          </td>
                          <td style={td}>{Math.round(r.signal_strength)}</td>
                          <td style={td}>{dash(setup)}</td>
                          <td style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs }}>{dash(exitRule)}</td>
                          <td style={{ ...td, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                            {outcomeSymbol(r, tab)}
                          </td>
                          <td style={td}>{hold}</td>
                          <td
                            style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs, color: colors.textMuted }}
                            title={r.gate_status ? JSON.stringify(r.gate_status) : undefined}
                          >
                            {gateSummary(r.gate_status)}
                          </td>
                          <td style={td}>{dash(r.market_regime_exit)}</td>
                          <td style={td}>{dash(r.decision_state_exit)}</td>
                          <td
                            style={{ ...td, maxWidth: 200, fontSize: typography.scale.xs, color: colors.textMuted }}
                            title={r.layer_scores ? JSON.stringify(r.layer_scores) : undefined}
                          >
                            {layerScoresSummary(r.layer_scores)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
            {nextCursor ? (
              <div style={{ marginTop: spacing[4], display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  style={{
                    padding: `${spacing[2]}px ${spacing[4]}px`,
                    borderRadius: borderRadius.md,
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                    color: colors.text,
                    fontSize: typography.scale.sm,
                    fontWeight: 600,
                    cursor: loadingMore ? "wait" : "pointer",
                    opacity: loadingMore ? 0.7 : 1
                  }}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}

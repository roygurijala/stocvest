"use client";

import { isoDateInNewYork } from "@/lib/market-hours-et";

export type PublicSignalOutcome = "pending" | "correct" | "incorrect" | "neutral";
export type PublicSignalDirection = "long" | "short" | "neutral";
export type SignalBias = "bullish" | "bearish" | "neutral";

/** Parsed `gate_status` from API (was `gate_status_json` in Dynamo). */
export type GateStatusPayload = Record<string, unknown> | unknown[];

export interface PublicSignal {
  signal_id?: string;
  symbol: string;
  direction: PublicSignalDirection;
  /** Original API bias for chips (bullish / bearish / neutral). */
  bias: SignalBias;
  signal_strength: number;
  timestamp_iso: string;
  outcome: PublicSignalOutcome;
  disclaimer?: string;
  price_at_signal?: number | null;
  price_outcome?: number | null;
  pattern?: string;
  outcome_1h?: string | null;
  outcome_1d?: string | null;
  resolved_1h?: boolean;
  resolved_1d?: boolean;
  price_1h_after?: number | null;
  price_1d_after?: number | null;
  /** Swing vs day track (fixed rules; not user customization). */
  mode?: "day" | "swing";
  layer_scores?: Record<string, number>;
  status?: string;
  /** ISO timestamp when the ledger row was closed (exit), if set. */
  closed_at?: string | null;
  ledger_entry_date_et?: string | null;
  ledger_exit_date_et?: string | null;
  entry_rationale?: string | null;
  exit_reason?: string | null;
  decision_state_entry?: string | null;
  decision_state_exit?: string | null;
  market_regime_exit?: string | null;
  gate_status?: GateStatusPayload | null;
  setup_type?: string | null;
  exit_rule?: string | null;
  max_adverse_excursion_pct?: number | null;
  max_favorable_excursion_pct?: number | null;
  hold_duration_minutes?: number | null;
  /** True when this row passed validation ledger entry gates at record time. */
  ledger_qualified?: boolean;
  /** False after a rule-based exit; true while the validation monitor still tracks the row. */
  ledger_position_open?: boolean;
  /** Audit vocabulary mapped from directional outcome at close. */
  validation_outcome?: "favorable" | "unfavorable" | "neutral";
  stop_level?: number | null;
  reference_structure_level?: number | null;
  regime_label_at_entry?: string | null;
  sector_label_at_entry?: string | null;
  vwap_state_at_entry?: string | null;
  regime_window_key?: string | null;
}

export type UserSignalHistoryPageSize = 25 | 50 | 75 | 100;

export interface UserSignalHistoryPage {
  items: PublicSignal[];
  next_cursor: string | null;
  page_size: number;
}

/** When API adds per-pattern stats, map them here for the landing accuracy bars. */
export interface PatternAccuracyRow {
  pattern_key: string;
  label: string;
  accuracy_percent: number;
  tone?: "long" | "short" | "amber" | "green";
}

export interface PerformanceSummary {
  total_signals_tracked: number;
  signals_evaluated: number;
  correct_direction_count: number;
  incorrect_direction_count: number;
  neutral_direction_count: number;
  directional_accuracy_percent: number;
  launch_date: string;
  date_range_days: number;
  disclaimer?: string;
  /** Optional: populated when GET /v1/signals/performance/summary includes per-pattern breakdown. */
  pattern_breakdown?: PatternAccuracyRow[];
}

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

function mapDirectionAndBias(rawDir: string): { direction: PublicSignalDirection; bias: SignalBias } {
  const d = rawDir.toLowerCase();
  if (d === "bullish" || d === "long" || d === "buy") {
    return { direction: "long", bias: "bullish" };
  }
  if (d === "bearish" || d === "short" || d === "sell") {
    return { direction: "short", bias: "bearish" };
  }
  return { direction: "neutral", bias: "neutral" };
}

function normalizePublicSignal(raw: Record<string, unknown>): PublicSignal | null {
  if (typeof raw.symbol !== "string" || typeof raw.direction !== "string" || typeof raw.timestamp_iso !== "string") {
    return null;
  }
  const strengthRaw = raw.signal_strength ?? raw.confidence;
  const strength = typeof strengthRaw === "number" ? strengthRaw : Number(strengthRaw);
  if (!Number.isFinite(strength)) {
    return null;
  }
  const outcomeRaw = raw.outcome;
  let outcome: PublicSignalOutcome;
  if (outcomeRaw === "pending") outcome = "pending";
  else if (outcomeRaw === "correct" || outcomeRaw === "win") outcome = "correct";
  else if (outcomeRaw === "incorrect" || outcomeRaw === "loss") outcome = "incorrect";
  else if (outcomeRaw === "neutral") outcome = "neutral";
  else return null;
  const { direction, bias } = mapDirectionAndBias(raw.direction);
  const sid = raw.signal_id;
  const pat = raw.pattern;
  const o1h = raw.outcome_1h;
  const o1d = raw.outcome_1d;
  const pAt = raw.price_at_signal;
  const modeRaw = raw.mode;
  const mode =
    modeRaw === "swing" || modeRaw === "day" ? (modeRaw as "day" | "swing") : undefined;
  const layersRaw = raw.layer_scores;
  let layer_scores: Record<string, number> | undefined;
  if (layersRaw != null && typeof layersRaw === "object" && !Array.isArray(layersRaw)) {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(layersRaw as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
      if (Number.isFinite(n)) o[k] = n;
    }
    layer_scores = Object.keys(o).length ? o : undefined;
  }
  const st = raw.status;
  const closedAt = raw.closed_at;
  const mae = raw.max_adverse_excursion_pct;
  const mfe = raw.max_favorable_excursion_pct;
  const holdMin = raw.hold_duration_minutes;
  const gsRaw = raw.gate_status;
  let gate_status: GateStatusPayload | null | undefined;
  if (gsRaw != null && typeof gsRaw === "object") {
    gate_status = gsRaw as GateStatusPayload;
  }
  return {
    signal_id: typeof sid === "string" ? sid : undefined,
    symbol: raw.symbol,
    direction,
    bias,
    signal_strength: strength,
    timestamp_iso: raw.timestamp_iso,
    outcome,
    disclaimer: typeof raw.disclaimer === "string" ? raw.disclaimer : undefined,
    price_at_signal: typeof pAt === "number" ? pAt : pAt != null ? Number(pAt) : null,
    pattern: typeof pat === "string" ? pat : undefined,
    outcome_1h: typeof o1h === "string" ? o1h : o1h == null ? null : String(o1h),
    outcome_1d: typeof o1d === "string" ? o1d : o1d == null ? null : String(o1d),
    resolved_1h: typeof raw.resolved_1h === "boolean" ? raw.resolved_1h : undefined,
    resolved_1d: typeof raw.resolved_1d === "boolean" ? raw.resolved_1d : undefined,
    price_1h_after:
      typeof raw.price_1h_after === "number"
        ? raw.price_1h_after
        : raw.price_1h_after != null
          ? Number(raw.price_1h_after)
          : null,
    price_1d_after:
      typeof raw.price_1d_after === "number"
        ? raw.price_1d_after
        : raw.price_1d_after != null
          ? Number(raw.price_1d_after)
          : null,
    mode,
    layer_scores,
    status: typeof st === "string" ? st : undefined,
    closed_at: typeof closedAt === "string" && closedAt.trim() ? closedAt : undefined,
    ledger_entry_date_et: _optStr(raw.ledger_entry_date_et),
    ledger_exit_date_et: _optStr(raw.ledger_exit_date_et),
    entry_rationale: _optStr(raw.entry_rationale),
    exit_reason: _optStr(raw.exit_reason),
    decision_state_entry: _optStr(raw.decision_state_entry),
    decision_state_exit: _optStr(raw.decision_state_exit),
    market_regime_exit: _optStr(raw.market_regime_exit),
    gate_status: gate_status ?? null,
    setup_type: _optStr(raw.setup_type),
    exit_rule: _optStr(raw.exit_rule),
    max_adverse_excursion_pct: _numOrNull(mae),
    max_favorable_excursion_pct: _numOrNull(mfe),
    hold_duration_minutes: _intOrUndef(holdMin),
    ledger_qualified: typeof raw.ledger_qualified === "boolean" ? raw.ledger_qualified : undefined,
    ledger_position_open: typeof raw.ledger_position_open === "boolean" ? raw.ledger_position_open : undefined,
    validation_outcome:
      raw.validation_outcome === "favorable" ||
      raw.validation_outcome === "unfavorable" ||
      raw.validation_outcome === "neutral"
        ? raw.validation_outcome
        : undefined,
    stop_level: _numOrNull(raw.stop_level),
    reference_structure_level: _numOrNull(raw.reference_structure_level),
    regime_label_at_entry: _optStr(raw.regime_label_at_entry),
    sector_label_at_entry: _optStr(raw.sector_label_at_entry),
    vwap_state_at_entry: _optStr(raw.vwap_state_at_entry),
    regime_window_key: _optStr(raw.regime_window_key)
  };
}

function _numOrNull(v: unknown): number | null | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function _intOrUndef(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

function _optStr(v: unknown): string | null | undefined {
  if (v == null) return undefined;
  if (typeof v !== "string") return String(v).trim() || undefined;
  const t = v.trim();
  return t || undefined;
}

function _parseUserHistoryPayload(data: unknown): UserSignalHistoryPage | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const o = data as Record<string, unknown>;
  const itemsRaw = o.items;
  if (!Array.isArray(itemsRaw)) {
    return null;
  }
  const items = itemsRaw
    .map((x) => (typeof x === "object" && x !== null ? normalizePublicSignal(x as Record<string, unknown>) : null))
    .filter((x): x is PublicSignal => x !== null);
  const next = o.next_cursor;
  const next_cursor =
    next === null || typeof next === "undefined" ? null : typeof next === "string" ? next : null;
  const ps = o.page_size;
  const page_size = typeof ps === "number" && Number.isFinite(ps) ? ps : 25;
  return { items, next_cursor, page_size };
}

/**
 * One page of authenticated user signal history. Default page size on the API is 25;
 * allowed sizes are 25, 50, 75, 100.
 */
export async function fetchUserSignalHistoryPage(params?: {
  days?: number;
  pageSize?: UserSignalHistoryPageSize;
  cursor?: string | null;
  symbol?: string;
  mode?: "day" | "swing";
  ledgerOnly?: boolean;
}): Promise<UserSignalHistoryPage | null> {
  const qs = new URLSearchParams();
  if (params?.days != null) {
    qs.set("days", String(params.days));
  }
  const ps: UserSignalHistoryPageSize = params?.pageSize ?? 25;
  qs.set("page_size", String(ps));
  if (params?.cursor) {
    qs.set("cursor", params.cursor);
  }
  if (params?.symbol?.trim()) {
    qs.set("symbol", params.symbol.trim().toUpperCase());
  }
  if (params?.mode === "day" || params?.mode === "swing") {
    qs.set("mode", params.mode);
  }
  if (params?.ledgerOnly) {
    qs.set("ledger_only", "true");
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const response = await fetch(`/api/stocvest/signals/me/history${suffix}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      return { items: [], next_cursor: null, page_size: ps };
    }
    const data = (await response.json()) as unknown;
    if (Array.isArray(data)) {
      const items = data
        .map((x) => (typeof x === "object" && x !== null ? normalizePublicSignal(x as Record<string, unknown>) : null))
        .filter((x): x is PublicSignal => x !== null);
      return { items, next_cursor: null, page_size: items.length };
    }
    return _parseUserHistoryPayload(data) ?? { items: [], next_cursor: null, page_size: ps };
  } catch {
    return { items: [], next_cursor: null, page_size: ps };
  }
}

/** Aggregates multiple pages (up to 12 × 100 rows) for tabs that need a full list. */
export async function fetchUserEvaluatedSignals(params?: {
  days?: number;
  symbol?: string;
  mode?: "day" | "swing";
  ledgerOnly?: boolean;
}): Promise<PublicSignal[] | null> {
  const all: PublicSignal[] = [];
  let cursor: string | undefined;
  const pageSize: UserSignalHistoryPageSize = 100;
  for (let i = 0; i < 12; i++) {
    const page = await fetchUserSignalHistoryPage({
      ...params,
      pageSize,
      cursor,
      ledgerOnly: params?.ledgerOnly
    });
    if (page === null) {
      return all.length ? all : null;
    }
    all.push(...page.items);
    if (!page.next_cursor) {
      break;
    }
    cursor = page.next_cursor;
  }
  return all;
}

export async function fetchLiveSignals(): Promise<PublicSignal[]> {
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/signals/recent`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((x) => (typeof x === "object" && x !== null ? normalizePublicSignal(x as Record<string, unknown>) : null))
      .filter((x): x is PublicSignal => x !== null);
  } catch {
    return [];
  }
}

export async function fetchPerformanceSummary(): Promise<PerformanceSummary> {
  const fallback: PerformanceSummary = {
    total_signals_tracked: 0,
    signals_evaluated: 0,
    correct_direction_count: 0,
    incorrect_direction_count: 0,
    neutral_direction_count: 0,
    directional_accuracy_percent: 0,
    launch_date: isoDateInNewYork(),
    date_range_days: 0
  };
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/signals/performance/summary`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) {
      return fallback;
    }
    const data = (await response.json()) as Record<string, unknown>;
    const evaluated = data.signals_evaluated ?? data.total_resolved;
    const accuracy = data.directional_accuracy_percent ?? data.win_rate_percent;
    const correctDir =
      typeof data.correct_direction_count === "number"
        ? data.correct_direction_count
        : typeof data.win_count === "number"
          ? data.win_count
          : fallback.correct_direction_count;
    const incorrectDir =
      typeof data.incorrect_direction_count === "number"
        ? data.incorrect_direction_count
        : typeof data.loss_count === "number"
          ? data.loss_count
          : fallback.incorrect_direction_count;
    const neutralDir =
      typeof data.neutral_direction_count === "number"
        ? data.neutral_direction_count
        : typeof data.neutral_count === "number"
          ? data.neutral_count
          : fallback.neutral_direction_count;
    const rawPb = data.pattern_breakdown;
    let pattern_breakdown: PatternAccuracyRow[] | undefined;
    if (Array.isArray(rawPb)) {
      const rows: PatternAccuracyRow[] = [];
      for (const item of rawPb) {
        if (typeof item !== "object" || item === null) continue;
        const o = item as Record<string, unknown>;
        const label = typeof o.label === "string" ? o.label : typeof o.pattern === "string" ? o.pattern : "";
        const pct = o.accuracy_percent ?? o.accuracy;
        const n = typeof pct === "number" ? pct : pct != null ? Number(pct) : Number.NaN;
        const key = typeof o.pattern_key === "string" ? o.pattern_key : label;
        if (!label.trim() || !Number.isFinite(n)) continue;
        const tone = o.tone;
        const t =
          tone === "long" || tone === "short" || tone === "amber" || tone === "green" ? tone : undefined;
        rows.push({
          pattern_key: key || label,
          label: label.trim(),
          accuracy_percent: Math.round(Math.max(0, Math.min(100, n)) * 10) / 10,
          tone: t
        });
      }
      if (rows.length > 0) pattern_breakdown = rows;
    }
    return {
      ...fallback,
      total_signals_tracked: typeof data.total_signals_tracked === "number" ? data.total_signals_tracked : fallback.total_signals_tracked,
      signals_evaluated: typeof evaluated === "number" ? evaluated : fallback.signals_evaluated,
      correct_direction_count: correctDir,
      incorrect_direction_count: incorrectDir,
      neutral_direction_count: neutralDir,
      directional_accuracy_percent: typeof accuracy === "number" ? accuracy : fallback.directional_accuracy_percent,
      launch_date: typeof data.launch_date === "string" ? data.launch_date : fallback.launch_date,
      date_range_days: typeof data.date_range_days === "number" ? data.date_range_days : fallback.date_range_days,
      disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : undefined,
      pattern_breakdown
    };
  } catch {
    return fallback;
  }
}

/**
 * Row label for 1h / 1d post-signal price reactions.
 *
 * Phrased to describe price behavior, not to judge the signal — the goal is transparency,
 * not a trading record. See "Past signal states" section in `signals-page-client.tsx`.
 */
export function formatHorizonOutcome(
  o: string | null | undefined
): { label: string; kind: "ok" | "bad" | "mid" | "pending" } {
  if (o === "correct") return { label: "Price moved in signal direction", kind: "ok" };
  if (o === "incorrect") return { label: "Price moved against signal direction", kind: "bad" };
  if (o === "neutral") return { label: "Price drifted (no clear move)", kind: "mid" };
  return { label: "Pending evaluation", kind: "pending" };
}

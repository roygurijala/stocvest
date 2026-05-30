"use client";

import {
  classifyAdminReadStatus,
  type AdminApiReadOutcome
} from "@/lib/api/admin-users";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Client-side typed access to the D10 Phase 3a admin proposal-review surface.
 *
 * Talks to four BFF routes under `/api/stocvest/admin/proposals` which proxy
 * verbatim to the upstream backend under `/v1/admin/proposals/*`. Every
 * function in this module is admin-only at the API layer — the backend
 * `analysis_authorized()` gate is the real perimeter and runs on each
 * request regardless of what the UI thinks. The frontend admin check in
 * `lib/auth/admin.ts` is only used to hide the surface from non-admins;
 * a 403 here always means the upstream gate rejected the call.
 *
 * Runtime validation is deliberately defensive (no Zod — the codebase
 * prefers manual type guards for the API surface). Malformed responses
 * collapse to `null` so callers can render a friendly empty state.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ProposalStatus = "pending" | "promoted" | "rejected" | "superseded";

/** Compact list-view projection. Matches the backend `ProposalSummaryRow.to_dict()`. */
export interface ProposalSummaryRow {
  proposal_id: string;
  status: ProposalStatus;
  created_at: string;
  created_by_job: string;
  baseline_parameter_version: string;
  has_swing_proposal: boolean;
  has_day_proposal: boolean;
  /**
   * `val_accuracy - val_accuracy_baseline` as a fraction in `[-1, 1]`. `null`
   * when the proposal does not target this mode (a swing-only proposal has
   * `day_val_accuracy_lift === null`, and vice versa).
   */
  swing_val_accuracy_lift: number | null;
  day_val_accuracy_lift: number | null;
  swing_val_signal_count: number | null;
  day_val_signal_count: number | null;
}

export interface ProposalListResponse {
  status: ProposalStatus;
  limit: number;
  items: ProposalSummaryRow[];
}

/** Per-mode composite override block. Mirrors `CompositeParameters`. */
export interface CompositeOverrideBlock {
  technical_weight: number;
  news_weight: number;
  macro_weight: number;
  sector_weight: number;
  geopolitical_weight: number;
  internals_weight: number;
  bullish_threshold?: number;
  bearish_threshold?: number;
}

/** Full proposal detail. Matches `proposal_to_detail_dict()`. */
export interface ProposalDetail {
  proposal_id: string;
  status: ProposalStatus;
  created_at: string;
  created_by_job: string;
  baseline_parameter_version: string;
  proposed_swing_composite: CompositeOverrideBlock | null;
  proposed_day_composite: CompositeOverrideBlock | null;
  train_window_start: string;
  train_window_end: string;
  val_window_start: string;
  val_window_end: string;
  evidence: Record<string, unknown> | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  promoted_to_version: string | null;
}

/** Result of one promote call. Matches the backend `PromotionResult.to_dict()`. */
export interface PromotionResult {
  success: boolean;
  proposal_id: string;
  new_parameter_version: string | null;
  superseded_pending_ids: string[];
  error: string | null;
}

/** Discriminated outcome returned by `promoteProposal` / `rejectProposal`. */
export type ProposalActionOutcome<T> =
  | { kind: "ok"; data: T }
  | {
      kind: "error";
      status: number;
      /** `error` code from the backend envelope when available, else `"unknown"`. */
      code: string;
      /** Human-readable message from the backend envelope when available. */
      message: string;
      /** Raw body for debugging — useful when the error envelope is malformed. */
      raw: unknown;
    };

// ── Runtime validation helpers ───────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStatus(v: unknown): ProposalStatus | null {
  return v === "pending" || v === "promoted" || v === "rejected" || v === "superseded"
    ? v
    : null;
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function parseInt0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return 0;
}

function parseStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function parseStrOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseSummaryRow(raw: unknown): ProposalSummaryRow | null {
  if (!isRecord(raw)) return null;
  const status = parseStatus(raw.status);
  const proposal_id = parseStr(raw.proposal_id);
  if (!status || !proposal_id) return null;
  return {
    proposal_id,
    status,
    created_at: parseStrOrEmpty(raw.created_at),
    created_by_job: parseStrOrEmpty(raw.created_by_job),
    baseline_parameter_version: parseStrOrEmpty(raw.baseline_parameter_version),
    has_swing_proposal: raw.has_swing_proposal === true,
    has_day_proposal: raw.has_day_proposal === true,
    swing_val_accuracy_lift: parseNum(raw.swing_val_accuracy_lift),
    day_val_accuracy_lift: parseNum(raw.day_val_accuracy_lift),
    swing_val_signal_count:
      typeof raw.swing_val_signal_count === "number" ? parseInt0(raw.swing_val_signal_count) : null,
    day_val_signal_count:
      typeof raw.day_val_signal_count === "number" ? parseInt0(raw.day_val_signal_count) : null
  };
}

function parseCompositeBlock(raw: unknown): CompositeOverrideBlock | null {
  if (!isRecord(raw)) return null;
  const t = parseNum(raw.technical_weight);
  const n = parseNum(raw.news_weight);
  const m = parseNum(raw.macro_weight);
  const s = parseNum(raw.sector_weight);
  const g = parseNum(raw.geopolitical_weight);
  const i = parseNum(raw.internals_weight);
  if (t === null || n === null || m === null || s === null || g === null || i === null) {
    return null;
  }
  const block: CompositeOverrideBlock = {
    technical_weight: t,
    news_weight: n,
    macro_weight: m,
    sector_weight: s,
    geopolitical_weight: g,
    internals_weight: i
  };
  const bull = parseNum(raw.bullish_threshold);
  const bear = parseNum(raw.bearish_threshold);
  if (bull !== null) block.bullish_threshold = bull;
  if (bear !== null) block.bearish_threshold = bear;
  return block;
}

function parseDetail(raw: unknown): ProposalDetail | null {
  if (!isRecord(raw)) return null;
  const proposal_id = parseStr(raw.proposal_id);
  const status = parseStatus(raw.status);
  if (!proposal_id || !status) return null;
  return {
    proposal_id,
    status,
    created_at: parseStrOrEmpty(raw.created_at),
    created_by_job: parseStrOrEmpty(raw.created_by_job),
    baseline_parameter_version: parseStrOrEmpty(raw.baseline_parameter_version),
    proposed_swing_composite: parseCompositeBlock(raw.proposed_swing_composite),
    proposed_day_composite: parseCompositeBlock(raw.proposed_day_composite),
    train_window_start: parseStrOrEmpty(raw.train_window_start),
    train_window_end: parseStrOrEmpty(raw.train_window_end),
    val_window_start: parseStrOrEmpty(raw.val_window_start),
    val_window_end: parseStrOrEmpty(raw.val_window_end),
    evidence: isRecord(raw.evidence) ? raw.evidence : null,
    reviewed_at: parseStr(raw.reviewed_at),
    reviewed_by: parseStr(raw.reviewed_by),
    review_note: parseStr(raw.review_note),
    promoted_to_version: parseStr(raw.promoted_to_version)
  };
}

function parsePromotionResult(raw: unknown): PromotionResult | null {
  if (!isRecord(raw)) return null;
  const proposal_id = parseStr(raw.proposal_id);
  if (!proposal_id) return null;
  return {
    success: raw.success === true,
    proposal_id,
    new_parameter_version: parseStr(raw.new_parameter_version),
    superseded_pending_ids: Array.isArray(raw.superseded_pending_ids)
      ? raw.superseded_pending_ids.filter((v): v is string => typeof v === "string")
      : [],
    error: parseStr(raw.error)
  };
}

async function readErrorEnvelope(
  response: Response
): Promise<{ code: string; message: string; raw: unknown }> {
  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    return { code: "unknown", message: response.statusText || "Request failed.", raw: null };
  }
  if (isRecord(raw)) {
    const code = typeof raw.error === "string" ? raw.error : "unknown";
    const message =
      typeof raw.message === "string" ? raw.message : response.statusText || "Request failed.";
    return { code, message, raw };
  }
  return { code: "unknown", message: response.statusText || "Request failed.", raw };
}

// ── Public fetch helpers ─────────────────────────────────────────────────────

export interface FetchProposalsParams {
  status?: ProposalStatus;
  /** Backend clamps to `[1, 100]`; the BFF passes through verbatim. */
  limit?: number;
}

/**
 * List proposals filtered by status (default `pending`), most recent first.
 * Returns `null` on 401 (auth surface notified for refresh-or-expire) or any
 * non-2xx / malformed response.
 */
export async function fetchProposals(
  params?: FetchProposalsParams
): Promise<ProposalListResponse | null> {
  const outcome = await fetchProposalsDiagnostic(params);
  return outcome.kind === "ok" ? outcome.data : null;
}

/**
 * Diagnostic variant — pairs with the equivalent helpers on the
 * users / audit APIs so every admin list page can render the actual
 * HTTP status + an actionable hint via {@link AdminApiErrorCard}.
 */
export async function fetchProposalsDiagnostic(
  params?: FetchProposalsParams
): Promise<AdminApiReadOutcome<ProposalListResponse>> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit && params.limit > 0) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/stocvest/admin/proposals${suffix}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
  } catch (exc) {
    return {
      kind: "error",
      error: {
        code: "network_error",
        status: 0,
        message:
          exc instanceof Error ? exc.message : "Network error reaching the backend.",
        hint: "Check your connection or the BFF dev server."
      }
    };
  }
  if (response.status === 401) {
    void surfaceAuthErrorIfAny(response);
    return { kind: "error", error: classifyAdminReadStatus(401, "Unauthenticated.") };
  }
  if (!response.ok) {
    return {
      kind: "error",
      error: classifyAdminReadStatus(response.status, "Request failed.")
    };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      kind: "error",
      error: {
        code: "malformed_response",
        status: response.status,
        message: "The backend returned a non-JSON response.",
        hint: "Check the API Lambda logs for an unhandled exception."
      }
    };
  }
  if (!isRecord(data)) {
    return {
      kind: "error",
      error: {
        code: "malformed_response",
        status: response.status,
        message: "The backend response was the wrong shape.",
        hint: "The frontend and backend may be on incompatible versions."
      }
    };
  }
  const status = parseStatus(data.status);
  if (!status) {
    return {
      kind: "error",
      error: {
        code: "malformed_response",
        status: response.status,
        message: "Proposal list response missing a valid status.",
        hint: "Check the API Lambda logs and verify the response shape."
      }
    };
  }
  const items = Array.isArray(data.items)
    ? (data.items.map(parseSummaryRow).filter(Boolean) as ProposalSummaryRow[])
    : [];
  return {
    kind: "ok",
    data: {
      status,
      limit: parseInt0(data.limit) || 20,
      items
    }
  };
}

/**
 * Fetch full detail (with evidence + per-mode override blocks) for one proposal.
 * Returns `null` on auth failure, 404, malformed body, or network error.
 */
export async function fetchProposalDetail(
  proposalId: string
): Promise<ProposalDetail | null> {
  if (!proposalId.trim()) return null;
  try {
    const response = await fetch(
      `/api/stocvest/admin/proposals/${encodeURIComponent(proposalId)}`,
      { method: "GET", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    return parseDetail(data);
  } catch {
    return null;
  }
}

/**
 * Promote a pending proposal to live — rotates the production composite
 * weights in Secrets Manager + appends a `ParameterHistory` row + marks the
 * proposal `promoted` + auto-supersedes any other still-pending proposals.
 *
 * Returns a discriminated outcome so the UI can surface the backend's
 * conflict / not-found / 500 envelopes verbatim. `ok` wraps a
 * {@link PromotionResult} with the new parameter version.
 */
export async function promoteProposal(
  proposalId: string
): Promise<ProposalActionOutcome<PromotionResult>> {
  if (!proposalId.trim()) {
    return {
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "proposal_id is required.",
      raw: null
    };
  }
  try {
    const response = await fetch(
      `/api/stocvest/admin/proposals/${encodeURIComponent(proposalId)}/promote`,
      { method: "POST", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
    }
    if (!response.ok) {
      const env = await readErrorEnvelope(response);
      return { kind: "error", status: response.status, ...env };
    }
    const data = (await response.json()) as unknown;
    const parsed = parsePromotionResult(data);
    if (!parsed) {
      return {
        kind: "error",
        status: 200,
        code: "malformed_response",
        message: "Promotion succeeded but response payload was malformed.",
        raw: data
      };
    }
    return { kind: "ok", data: parsed };
  } catch (exc) {
    return {
      kind: "error",
      status: 0,
      code: "network_error",
      message: exc instanceof Error ? exc.message : "Network error.",
      raw: null
    };
  }
}

/**
 * Reject a pending proposal with an optional human-readable note.
 *
 * Returns a discriminated outcome — `ok` wraps the post-rejection
 * {@link ProposalDetail} (status now `"rejected"`, `reviewed_by` /
 * `reviewed_at` / `review_note` stamped).
 */
export async function rejectProposal(
  proposalId: string,
  options?: { reviewNote?: string }
): Promise<ProposalActionOutcome<ProposalDetail>> {
  if (!proposalId.trim()) {
    return {
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "proposal_id is required.",
      raw: null
    };
  }
  const payload: Record<string, string> = {};
  if (options?.reviewNote && options.reviewNote.trim()) {
    payload.review_note = options.reviewNote.trim();
  }
  try {
    const response = await fetch(
      `/api/stocvest/admin/proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
    }
    if (!response.ok) {
      const env = await readErrorEnvelope(response);
      return { kind: "error", status: response.status, ...env };
    }
    const data = (await response.json()) as unknown;
    const parsed = parseDetail(data);
    if (!parsed) {
      return {
        kind: "error",
        status: 200,
        code: "malformed_response",
        message: "Rejection succeeded but response payload was malformed.",
        raw: data
      };
    }
    return { kind: "ok", data: parsed };
  } catch (exc) {
    return {
      kind: "error",
      status: 0,
      code: "network_error",
      message: exc instanceof Error ? exc.message : "Network error.",
      raw: null
    };
  }
}

// ── Display helpers ──────────────────────────────────────────────────────────

/**
 * Render an accuracy-lift fraction (e.g. `0.052`) as a percentage-points
 * string (`"+5.2pp"`). Returns `"—"` for `null` (no resolved rows in this
 * mode). Mirrors `formatAccuracyDelta` in historical-validation.ts so the
 * admin surface and the validation panel speak the same "no data" dialect.
 */
export function formatAccuracyLift(lift: number | null): string {
  if (lift === null || !Number.isFinite(lift)) return "—";
  const pp = lift * 100;
  if (pp === 0) return "0.0pp";
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp.toFixed(1)}pp`;
}

/**
 * Friendly label for one composite weight key (`"technical_weight"` →
 * `"Technical"`). Used by the detail view's weight tables.
 */
export function compositeWeightLabel(key: keyof CompositeOverrideBlock): string {
  switch (key) {
    case "technical_weight":
      return "Technical";
    case "news_weight":
      return "News";
    case "macro_weight":
      return "Macro";
    case "sector_weight":
      return "Sector";
    case "geopolitical_weight":
      return "Geopolitical";
    case "internals_weight":
      return "Market Internals";
    case "bullish_threshold":
      return "Bullish threshold";
    case "bearish_threshold":
      return "Bearish threshold";
    default:
      return key;
  }
}

"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Client-side typed access to the D10 Phase 4 admin parameter-rollback surface.
 *
 * Talks to two BFF routes under `/api/stocvest/admin/parameters` which proxy
 * verbatim to the upstream backend under `/v1/admin/parameters/*`:
 *
 *   * `GET  /history` — list prior parameter versions for the rollback picker.
 *   * `POST /rollback` — body `{target_version}`, rotates weights backward.
 *
 * Both functions are admin-only at the API layer — the backend
 * `analysis_authorized()` gate is the real perimeter and runs on each
 * request regardless of what the UI thinks. The frontend admin check in
 * `lib/auth/admin.ts` only hides the surface from non-admins; a 403 here
 * always means the upstream gate rejected the call.
 *
 * Runtime validation is intentionally defensive (no Zod — matches the
 * `admin-proposals.ts` convention). Malformed responses collapse to
 * `null` so callers can render a friendly empty state.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One row from the `ParameterHistory` table — matches the backend
 * `ParameterHistorySummaryRow.to_dict()`. */
export interface ParameterHistorySummaryRow {
  version: string;
  created_at: string;
  reason: string;
  changed_by: string;
  /** Best-effort metadata stamped by the writer; older rows may be 0. */
  signal_count_on_change: number;
  accuracy_before_change: number;
  /** True when this row's version equals the currently-live secret value.
   * The UI uses this to disable the "Roll back to this" button for the
   * row the admin is already on. */
  is_current_live_version: boolean;
}

export interface ParameterHistoryListResponse {
  limit: number;
  items: ParameterHistorySummaryRow[];
}

/** Result of one rollback call — matches the backend `RollbackResult.to_dict()`. */
export interface RollbackResult {
  success: boolean;
  target_version: string;
  rolled_back_from: string | null;
  /** Freshly-minted version string when the rollback succeeded. Always
   * different from `target_version` — see the orchestrator's
   * "forward-write a new version" invariant. */
  new_parameter_version: string | null;
  error: string | null;
  extras: Record<string, unknown>;
}

/** Discriminated outcome returned by `rollbackToVersion`. */
export type RollbackOutcome =
  | { kind: "ok"; data: RollbackResult }
  | {
      kind: "error";
      status: number;
      /** `error` code from the backend envelope when available, else `"unknown"`. */
      code: string;
      /** Human-readable message from the backend envelope when available. */
      message: string;
      /** Raw body for debugging — useful when the envelope is malformed. */
      raw: unknown;
    };

// ── Runtime validation helpers ───────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function parseStrOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseNum0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function parseInt0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return 0;
}

function parseHistoryRow(raw: unknown): ParameterHistorySummaryRow | null {
  if (!isRecord(raw)) return null;
  const version = parseStr(raw.version);
  if (!version) return null;
  return {
    version,
    created_at: parseStrOrEmpty(raw.created_at),
    reason: parseStrOrEmpty(raw.reason),
    changed_by: parseStrOrEmpty(raw.changed_by),
    signal_count_on_change: parseInt0(raw.signal_count_on_change),
    accuracy_before_change: parseNum0(raw.accuracy_before_change),
    is_current_live_version: raw.is_current_live_version === true
  };
}

function parseRollbackResult(raw: unknown): RollbackResult | null {
  if (!isRecord(raw)) return null;
  const target_version = parseStr(raw.target_version);
  if (!target_version) return null;
  return {
    success: raw.success === true,
    target_version,
    rolled_back_from: parseStr(raw.rolled_back_from),
    new_parameter_version: parseStr(raw.new_parameter_version),
    error: parseStr(raw.error),
    extras: isRecord(raw.extras) ? raw.extras : {}
  };
}

async function readErrorEnvelope(
  response: Response
): Promise<{ code: string; message: string; raw: unknown }> {
  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    return {
      code: "unknown",
      message: response.statusText || "Request failed.",
      raw: null
    };
  }
  if (isRecord(raw)) {
    const code = typeof raw.error === "string" ? raw.error : "unknown";
    const message =
      typeof raw.message === "string"
        ? raw.message
        : response.statusText || "Request failed.";
    return { code, message, raw };
  }
  return {
    code: "unknown",
    message: response.statusText || "Request failed.",
    raw
  };
}

// ── Public fetch helpers ─────────────────────────────────────────────────────

export interface FetchParameterHistoryParams {
  /** Backend clamps to `[1, 200]`; the BFF passes through verbatim. */
  limit?: number;
}

/**
 * List parameter history rows, newest first. Returns `null` on 401 (auth
 * surface notified for refresh-or-expire) or any non-2xx / malformed
 * response so the UI can render a clean empty state.
 */
export async function fetchParameterHistory(
  params?: FetchParameterHistoryParams
): Promise<ParameterHistoryListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.limit && params.limit > 0) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const response = await fetch(`/api/stocvest/admin/parameters/history${suffix}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    const items = Array.isArray(data.items)
      ? (data.items
          .map(parseHistoryRow)
          .filter(Boolean) as ParameterHistorySummaryRow[])
      : [];
    return {
      limit: parseInt0(data.limit) || 50,
      items
    };
  } catch {
    return null;
  }
}

/**
 * Roll the live parameters back to `targetVersion`. The backend creates
 * a fresh `ParameterHistory` row whose payload matches the target row
 * — `new_parameter_version` in the response is the new version string
 * (always different from `targetVersion`).
 *
 * Returns a discriminated outcome so the UI can surface the backend's
 * 404 / 409 / 500 envelopes verbatim. `ok` wraps a {@link RollbackResult}.
 */
export async function rollbackToVersion(targetVersion: string): Promise<RollbackOutcome> {
  const trimmed = targetVersion.trim();
  if (!trimmed) {
    return {
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "target_version is required.",
      raw: null
    };
  }
  try {
    const response = await fetch("/api/stocvest/admin/parameters/rollback", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_version: trimmed })
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
    }
    if (!response.ok) {
      const env = await readErrorEnvelope(response);
      return { kind: "error", status: response.status, ...env };
    }
    const data = (await response.json()) as unknown;
    const parsed = parseRollbackResult(data);
    if (!parsed) {
      return {
        kind: "error",
        status: 200,
        code: "malformed_response",
        message: "Rollback succeeded but response payload was malformed.",
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

/** Human-readable label for a rollback error code. */
export function rollbackErrorLabel(code: string): string {
  switch (code) {
    case "conflict":
      return "Target version is already live.";
    case "not_found":
      return "Target version is not in history.";
    case "internal_error":
      return "Rollback failed; please retry or investigate.";
    case "bad_request":
      return "Please pick a target version.";
    case "network_error":
      return "Network error — please retry.";
    case "malformed_response":
      return "Server returned an unexpected response.";
    default:
      return "Rollback failed.";
  }
}

/** Render a ParameterHistoryRow's accuracy_before_change as a friendly percentage,
 * or "—" when zero (which is the writer's sentinel for "not populated"). */
export function formatAccuracyBeforeChange(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

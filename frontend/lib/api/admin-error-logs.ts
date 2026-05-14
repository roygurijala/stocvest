"use client";

import {
  classifyAdminReadStatus,
  type AdminApiReadError,
  type AdminApiReadOutcome
} from "@/lib/api/admin-users";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/** One row from CloudWatch Logs Insights (Lambda stderr / platform lines). */
export interface AdminErrorLogRow {
  timestamp: string;
  log_group: string;
  message: string;
}

export interface AdminErrorLogsResponse {
  days: number;
  limit: number;
  log_group_prefix: string;
  log_groups: string[];
  window_start: string;
  window_end: string;
  items: AdminErrorLogRow[];
  statistics: Record<string, unknown>;
  query_error: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseNum0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function parseRow(raw: unknown): AdminErrorLogRow | null {
  if (!isRecord(raw)) return null;
  const message = parseStr(raw.message);
  if (!message.trim()) return null;
  return {
    timestamp: parseStr(raw.timestamp),
    log_group: parseStr(raw.log_group),
    message
  };
}

function makeNetworkError(exc: unknown): AdminApiReadError {
  return {
    code: "network_error",
    status: 0,
    message: exc instanceof Error ? exc.message : "Network error.",
    hint: "Check your connection and try again."
  };
}

export interface FetchAdminErrorLogsParams {
  days?: number;
  limit?: number;
}

export async function fetchAdminErrorLogsDiagnostic(
  params: FetchAdminErrorLogsParams = {}
): Promise<AdminApiReadOutcome<AdminErrorLogsResponse>> {
  const qs = new URLSearchParams();
  if (params.days != null && params.days > 0) qs.set("days", String(params.days));
  if (params.limit != null && params.limit > 0) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/stocvest/admin/error-logs${suffix}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
  } catch (exc) {
    return { kind: "error", error: makeNetworkError(exc) };
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
  const items = Array.isArray(data.items)
    ? (data.items.map(parseRow).filter(Boolean) as AdminErrorLogRow[])
    : [];
  const log_groups = Array.isArray(data.log_groups)
    ? data.log_groups.filter((g): g is string => typeof g === "string")
    : [];
  return {
    kind: "ok",
    data: {
      days: parseNum0(data.days) || 7,
      limit: parseNum0(data.limit) || 300,
      log_group_prefix: parseStr(data.log_group_prefix),
      log_groups,
      window_start: parseStr(data.window_start),
      window_end: parseStr(data.window_end),
      items,
      statistics: isRecord(data.statistics) ? data.statistics : {},
      query_error: typeof data.query_error === "string" ? data.query_error : null
    }
  };
}

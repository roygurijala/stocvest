"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Typed client for the admin audit-log surface.
 *
 * Two reads:
 *
 * - `fetchRecentAuditEvents` — newest-first global feed for the admin
 *   audit page. Optional `module` / `route_prefix` filters reduce the
 *   wire payload when the operator is hunting for a specific action.
 * - `fetchUserAuditEvents` — per-user timeline (powers the user-detail
 *   side panel on the users page). Wraps the older
 *   `/v1/admin/audit/users/{user_id}` route that already existed.
 *
 * Both reads collapse to `null` on auth failure or any non-2xx so the
 * UI can render a friendly empty state.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Mirrors :class:`stocvest.data.models.AuditEvent.model_dump`. */
export interface AuditEventRow {
  event_id: string;
  occurred_at: string;
  module: string;
  route: string;
  method: string;
  path: string;
  request_id: string | null;
  session_id: string | null;
  user_id: string | null;
  status_code: number;
  outcome: string;
  entitlement_snapshot: Record<string, unknown>;
  pricing_snapshot: Record<string, unknown>;
  request_summary: Record<string, unknown>;
  response_summary: Record<string, unknown>;
  market_snapshot: Record<string, unknown>;
}

export interface RecentAuditResponse {
  limit: number;
  module: string | null;
  route_prefix: string | null;
  items: AuditEventRow[];
}

// ── Validation helpers ───────────────────────────────────────────────────────

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

function parseStrOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parseDict(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function parseAuditEvent(raw: unknown): AuditEventRow | null {
  if (!isRecord(raw)) return null;
  const event_id = parseStr(raw.event_id);
  const occurred_at = parseStr(raw.occurred_at);
  if (!event_id || !occurred_at) return null;
  return {
    event_id,
    occurred_at,
    module: parseStr(raw.module),
    route: parseStr(raw.route),
    method: parseStr(raw.method),
    path: parseStr(raw.path),
    request_id: parseStrOrNull(raw.request_id),
    session_id: parseStrOrNull(raw.session_id),
    user_id: parseStrOrNull(raw.user_id),
    status_code: parseNum0(raw.status_code),
    outcome: parseStr(raw.outcome) || "unknown",
    entitlement_snapshot: parseDict(raw.entitlement_snapshot),
    pricing_snapshot: parseDict(raw.pricing_snapshot),
    request_summary: parseDict(raw.request_summary),
    response_summary: parseDict(raw.response_summary),
    market_snapshot: parseDict(raw.market_snapshot)
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface FetchRecentAuditParams {
  limit?: number;
  module?: string;
  routePrefix?: string;
}

export async function fetchRecentAuditEvents(
  params: FetchRecentAuditParams = {}
): Promise<RecentAuditResponse | null> {
  const qs = new URLSearchParams();
  if (params.limit && params.limit > 0) qs.set("limit", String(params.limit));
  if (params.module && params.module.trim()) qs.set("module", params.module.trim());
  if (params.routePrefix && params.routePrefix.trim()) {
    qs.set("route_prefix", params.routePrefix.trim());
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const response = await fetch(`/api/stocvest/admin/audit/recent${suffix}`, {
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
      ? (data.items.map(parseAuditEvent).filter(Boolean) as AuditEventRow[])
      : [];
    return {
      limit: parseNum0(data.limit) || 100,
      module: parseStrOrNull(data.module),
      route_prefix: parseStrOrNull(data.route_prefix),
      items
    };
  } catch {
    return null;
  }
}

export async function fetchUserAuditEvents(
  userId: string,
  options: { limit?: number } = {}
): Promise<AuditEventRow[] | null> {
  const trimmed = userId.trim();
  if (!trimmed) return null;
  const qs = new URLSearchParams();
  if (options.limit && options.limit > 0) qs.set("limit", String(options.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const response = await fetch(
      `/api/stocvest/admin/audit/users/${encodeURIComponent(trimmed)}${suffix}`,
      { method: "GET", credentials: "include", cache: "no-store" }
    );
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return null;
    return data.map(parseAuditEvent).filter(Boolean) as AuditEventRow[];
  } catch {
    return null;
  }
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function statusCodeTone(code: number): "success" | "warning" | "error" | "neutral" {
  if (code === 0) return "neutral";
  if (code >= 200 && code < 300) return "success";
  if (code >= 400 && code < 500) return "warning";
  if (code >= 500) return "error";
  return "neutral";
}

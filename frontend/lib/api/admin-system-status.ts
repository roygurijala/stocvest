"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import type { AuditEventRow } from "@/lib/api/admin-audit";
import type { ParameterHistorySummaryRow } from "@/lib/api/admin-parameters";

/**
 * Typed client for `GET /v1/admin/system-status`.
 *
 * Returns the aggregated operations snapshot that powers the admin hub
 * Overview page's "Operations overview" tile. Every backend field
 * collapses to a safe default when its source is unconfigured, so the
 * UI always has something to render.
 */

export interface SystemStatusResponse {
  current_parameter: {
    version: string;
    created_at: string;
    notes: string;
  };
  latest_history: ParameterHistorySummaryRow | null;
  pending_proposal_count: number;
  admin_user_count: number;
  founding_member_count: number;
  recent_audit_events: AuditEventRow[];
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

function parseInt0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return 0;
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
    request_id: typeof raw.request_id === "string" ? raw.request_id : null,
    session_id: typeof raw.session_id === "string" ? raw.session_id : null,
    user_id: typeof raw.user_id === "string" ? raw.user_id : null,
    status_code: parseNum0(raw.status_code),
    outcome: parseStr(raw.outcome) || "unknown",
    entitlement_snapshot: isRecord(raw.entitlement_snapshot) ? raw.entitlement_snapshot : {},
    pricing_snapshot: isRecord(raw.pricing_snapshot) ? raw.pricing_snapshot : {},
    request_summary: isRecord(raw.request_summary) ? raw.request_summary : {},
    response_summary: isRecord(raw.response_summary) ? raw.response_summary : {},
    market_snapshot: isRecord(raw.market_snapshot) ? raw.market_snapshot : {}
  };
}

function parseHistorySummary(raw: unknown): ParameterHistorySummaryRow | null {
  if (!isRecord(raw)) return null;
  const version = parseStr(raw.version);
  if (!version) return null;
  return {
    version,
    created_at: parseStr(raw.created_at),
    reason: parseStr(raw.reason),
    changed_by: parseStr(raw.changed_by),
    signal_count_on_change: parseInt0(raw.signal_count_on_change),
    accuracy_before_change: parseNum0(raw.accuracy_before_change),
    is_current_live_version: raw.is_current_live_version === true
  };
}

export async function fetchSystemStatus(): Promise<SystemStatusResponse | null> {
  try {
    const response = await fetch("/api/stocvest/admin/system-status", {
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
    const currentParam = isRecord(data.current_parameter) ? data.current_parameter : {};
    const recentEvents = Array.isArray(data.recent_audit_events)
      ? (data.recent_audit_events.map(parseAuditEvent).filter(Boolean) as AuditEventRow[])
      : [];
    return {
      current_parameter: {
        version: parseStr(currentParam.version),
        created_at: parseStr(currentParam.created_at),
        notes: parseStr(currentParam.notes)
      },
      latest_history: parseHistorySummary(data.latest_history),
      pending_proposal_count: parseInt0(data.pending_proposal_count),
      admin_user_count: parseInt0(data.admin_user_count),
      founding_member_count: parseInt0(data.founding_member_count),
      recent_audit_events: recentEvents
    };
  } catch {
    return null;
  }
}

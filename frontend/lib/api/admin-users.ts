"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Client-side typed access to the admin user-management surface.
 *
 * Talks to five BFF routes under `/api/stocvest/admin/users` which
 * proxy verbatim to the upstream backend under `/v1/admin/users/*`:
 *
 *   * `GET    /search`            — email-prefix lookup
 *   * `GET    /[user_id]`         — full per-user detail
 *   * `POST   /[user_id]/reset-password`
 *   * `POST   /[user_id]/groups/[group]`
 *   * `DELETE /[user_id]/groups/[group]`
 *
 * Every function is admin-only at the API layer — the backend
 * `analysis_authorized()` gate is the real perimeter. A 403 here always
 * means the upstream gate rejected the call. The frontend admin check
 * in `lib/auth/admin.ts` only hides the surface from non-admins.
 *
 * Runtime validation is deliberately defensive (no Zod — matches the
 * `admin-proposals.ts` convention). Malformed responses collapse to
 * `null` so callers can render a friendly empty state.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Compact list-view projection from `GET /search`. */
export interface AdminUserSummaryRow {
  user_id: string;
  username: string;
  email: string;
  email_verified: boolean;
  status: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserSearchResponse {
  query: string;
  limit: number;
  items: AdminUserSummaryRow[];
  /**
   * Opaque Cognito ``PaginationToken`` echoed from the upstream
   * response. ``null`` on the last page. Round-trip verbatim — never
   * try to parse, mutate, or fabricate one.
   */
  next_token: string | null;
}

/** Full per-user payload from `GET /[user_id]`. */
export interface AdminUserDetail {
  user_id: string;
  username: string;
  email: string;
  email_verified: boolean;
  status: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  groups: string[];
  is_admin: boolean;
  profile: {
    subscription_plan: string;
    trading_mode: string;
    onboarding_completed: boolean;
    onboarding_completed_at: string | null;
    legal_acknowledged: boolean;
    legal_acknowledged_at: string | null;
    legal_acknowledged_version: string | null;
    beta_full_access: boolean;
    beta_access_until: string | null;
    beta_access_granted_at: string | null;
    has_full_access: boolean;
    has_ai_explanations: boolean;
  };
}

/** Discriminated outcome shared by every mutation in this module. */
export type AdminUserMutationOutcome<T = unknown> =
  | { kind: "ok"; data: T }
  | {
      kind: "error";
      status: number;
      code: string;
      message: string;
      raw: unknown;
    };

// ── Runtime validation helpers ───────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseBool(v: unknown): boolean {
  return v === true;
}

function parseSummaryRow(raw: unknown): AdminUserSummaryRow | null {
  if (!isRecord(raw)) return null;
  const user_id = typeof raw.user_id === "string" && raw.user_id ? raw.user_id : null;
  if (!user_id) return null;
  return {
    user_id,
    username: parseStr(raw.username),
    email: parseStr(raw.email),
    email_verified: parseBool(raw.email_verified),
    status: parseStr(raw.status),
    enabled: raw.enabled === undefined ? true : parseBool(raw.enabled),
    created_at: parseStr(raw.created_at),
    updated_at: parseStr(raw.updated_at)
  };
}

function parseDetail(raw: unknown): AdminUserDetail | null {
  if (!isRecord(raw)) return null;
  const summary = parseSummaryRow(raw);
  if (!summary) return null;
  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  const profileRaw = isRecord(raw.profile) ? raw.profile : {};
  return {
    ...summary,
    groups: groupsRaw.filter((g): g is string => typeof g === "string"),
    is_admin: parseBool(raw.is_admin),
    profile: {
      subscription_plan: parseStr(profileRaw.subscription_plan) || "free",
      trading_mode: parseStr(profileRaw.trading_mode) || "paper",
      onboarding_completed: parseBool(profileRaw.onboarding_completed),
      onboarding_completed_at:
        typeof profileRaw.onboarding_completed_at === "string"
          ? profileRaw.onboarding_completed_at
          : null,
      legal_acknowledged: parseBool(profileRaw.legal_acknowledged),
      legal_acknowledged_at:
        typeof profileRaw.legal_acknowledged_at === "string"
          ? profileRaw.legal_acknowledged_at
          : null,
      legal_acknowledged_version:
        typeof profileRaw.legal_acknowledged_version === "string"
          ? profileRaw.legal_acknowledged_version
          : null,
      beta_full_access: parseBool(profileRaw.beta_full_access),
      beta_access_until:
        typeof profileRaw.beta_access_until === "string"
          ? profileRaw.beta_access_until
          : null,
      beta_access_granted_at:
        typeof profileRaw.beta_access_granted_at === "string"
          ? profileRaw.beta_access_granted_at
          : null,
      has_full_access: parseBool(profileRaw.has_full_access),
      has_ai_explanations: parseBool(profileRaw.has_ai_explanations)
    }
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
    return {
      code: typeof raw.error === "string" ? raw.error : "unknown",
      message:
        typeof raw.message === "string"
          ? raw.message
          : response.statusText || "Request failed.",
      raw
    };
  }
  return {
    code: "unknown",
    message: response.statusText || "Request failed.",
    raw
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * List or search users with token-based pagination.
 *
 * Behaviour matches the unified ``GET /v1/admin/users/search``:
 *
 * * Empty ``query`` (or omitted) → returns the first page of *all*
 *   users in the pool, so the Admin Users page can render a useful
 *   list on mount without making the admin type anything first.
 * * Non-empty ``query`` → email-prefix search (Cognito ``email ^=``).
 * * ``pageToken`` (from a previous response's ``next_token``) → fetch
 *   the next page. Cognito tokens are **opaque** — round-trip only,
 *   never construct.
 *
 * Returns ``null`` on auth failure or any non-2xx upstream so the UI
 * renders a clean empty state without ad-hoc try/catch.
 */
export async function searchUsers(
  query: string,
  options: { limit?: number; pageToken?: string | null } = {}
): Promise<AdminUserSearchResponse | null> {
  const q = (query ?? "").trim();
  const limit = options.limit && options.limit > 0 ? options.limit : 25;
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  qs.set("limit", String(limit));
  const token = (options.pageToken ?? "").trim();
  if (token) qs.set("page_token", token);
  try {
    const response = await fetch(`/api/stocvest/admin/users/search?${qs.toString()}`, {
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
          .map(parseSummaryRow)
          .filter(Boolean) as AdminUserSummaryRow[])
      : [];
    const nextRaw = data.next_token;
    const next_token = typeof nextRaw === "string" && nextRaw.trim() ? nextRaw : null;
    return {
      query: parseStr(data.query) || q,
      limit:
        typeof data.limit === "number" && Number.isFinite(data.limit)
          ? data.limit
          : limit,
      items,
      next_token
    };
  } catch {
    return null;
  }
}

/**
 * Fetch one user's full detail (Cognito + UserProfile + groups).
 * Returns `null` on any non-2xx response (including 404 — caller treats
 * that as "user not found in Cognito").
 */
export async function fetchUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const trimmed = userId.trim();
  if (!trimmed) return null;
  try {
    const response = await fetch(
      `/api/stocvest/admin/users/${encodeURIComponent(trimmed)}`,
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

// ── Mutations ────────────────────────────────────────────────────────────────

async function postOrDelete<T>(
  url: string,
  method: "POST" | "DELETE",
  parse: (raw: unknown) => T | null
): Promise<AdminUserMutationOutcome<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" }
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
    }
    if (!response.ok) {
      const env = await readErrorEnvelope(response);
      return { kind: "error", status: response.status, ...env };
    }
    const data = (await response.json()) as unknown;
    const parsed = parse(data);
    if (parsed === null) {
      return {
        kind: "error",
        status: 200,
        code: "malformed_response",
        message: "Server returned an unexpected response.",
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

export interface ResetPasswordResult {
  user_id: string;
  username: string;
  message: string;
}

export function resetUserPassword(
  userId: string
): Promise<AdminUserMutationOutcome<ResetPasswordResult>> {
  const trimmed = userId.trim();
  if (!trimmed) {
    return Promise.resolve({
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "user_id is required.",
      raw: null
    });
  }
  return postOrDelete(
    `/api/stocvest/admin/users/${encodeURIComponent(trimmed)}/reset-password`,
    "POST",
    (raw) => {
      if (!isRecord(raw) || typeof raw.user_id !== "string") return null;
      return {
        user_id: raw.user_id,
        username: parseStr(raw.username),
        message: parseStr(raw.message)
      };
    }
  );
}

export interface GroupMutationResult {
  user_id: string;
  group: string;
  action: "add" | "remove";
  groups?: string[];
  is_admin?: boolean;
}

function parseGroupMutation(raw: unknown): GroupMutationResult | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.user_id !== "string" || typeof raw.group !== "string") return null;
  const action = raw.action === "remove" ? "remove" : "add";
  return {
    user_id: raw.user_id,
    group: raw.group,
    action,
    groups: Array.isArray(raw.groups)
      ? (raw.groups.filter((g) => typeof g === "string") as string[])
      : undefined,
    is_admin: raw.is_admin === true ? true : raw.is_admin === false ? false : undefined
  };
}

export function addUserToGroup(
  userId: string,
  group: string
): Promise<AdminUserMutationOutcome<GroupMutationResult>> {
  const u = userId.trim();
  const g = group.trim();
  if (!u || !g) {
    return Promise.resolve({
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "user_id and group are required.",
      raw: null
    });
  }
  return postOrDelete(
    `/api/stocvest/admin/users/${encodeURIComponent(u)}/groups/${encodeURIComponent(g)}`,
    "POST",
    parseGroupMutation
  );
}

export function removeUserFromGroup(
  userId: string,
  group: string
): Promise<AdminUserMutationOutcome<GroupMutationResult>> {
  const u = userId.trim();
  const g = group.trim();
  if (!u || !g) {
    return Promise.resolve({
      kind: "error",
      status: 400,
      code: "bad_request",
      message: "user_id and group are required.",
      raw: null
    });
  }
  return postOrDelete(
    `/api/stocvest/admin/users/${encodeURIComponent(u)}/groups/${encodeURIComponent(g)}`,
    "DELETE",
    parseGroupMutation
  );
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function userMutationErrorLabel(code: string): string {
  switch (code) {
    case "forbidden":
      return "You are not authorized for this action.";
    case "not_found":
      return "User not found in Cognito.";
    case "bad_request":
      return "The request was invalid.";
    case "internal_error":
      return "The server failed; please retry or check Cognito.";
    case "network_error":
      return "Network error — please retry.";
    case "malformed_response":
      return "Server returned an unexpected response.";
    default:
      return "Action failed.";
  }
}

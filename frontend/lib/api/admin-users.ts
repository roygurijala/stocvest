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
  /** From UserProfile (billing). */
  subscription_plan: string;
  /** ISO timestamp from throttled GET /v1/users/me; null if never seen. */
  last_active_at: string | null;
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

/**
 * Diagnostic detail captured when a read fails. Surfaces the HTTP
 * status so the UI can render an actionable error message (e.g.
 * "404 → admin routes not deployed; run terraform apply") instead of
 * a generic "Failed to load users." Replaces the previous
 * `null`-on-failure convention which silently hid the real cause.
 */
export interface AdminApiReadError {
  /** Lowercase short code for switch/case branching in the UI. */
  code:
    | "unauthenticated"
    | "forbidden"
    | "not_deployed"
    | "upstream_error"
    | "network_error"
    | "malformed_response";
  /** Raw HTTP status from the BFF response, or 0 on network failure. */
  status: number;
  /** Human-readable single-line summary of what went wrong. */
  message: string;
  /** Suggested next action — surfaced under the error message. */
  hint: string;
}

export type AdminApiReadOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; error: AdminApiReadError };

/**
 * Pure mapper from HTTP status -> diagnostic envelope. Centralised so
 * every admin read renders the same hint copy for the same failure
 * mode. Bumping a hint here propagates to every list page at once.
 */
/**
 * Read a non-2xx admin response and translate its body into a typed
 * {@link AdminApiReadError}. When the backend returns the structured
 * ``{ error, message, hint }`` envelope used by the admin handlers
 * (e.g. the 503 ``config_error`` body returned when
 * ``COGNITO_USER_POOL_ID`` is unset), we prefer the backend's own
 * ``message``/``hint`` over the generic
 * {@link classifyAdminReadStatus} copy — the backend is the only
 * thing that knows *which* dependency is mis-wired.
 *
 * Falls back to {@link classifyAdminReadStatus} when the body is
 * missing, non-JSON, or doesn't match the envelope shape.
 */
export async function readAdminErrorEnvelope(
  response: Response
): Promise<AdminApiReadError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    return classifyAdminReadStatus(response.status, "Request failed.");
  }
  if (!isRecord(body)) {
    return classifyAdminReadStatus(response.status, "Request failed.");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const hint = typeof body.hint === "string" ? body.hint.trim() : "";
  // 503 + ``code: cognito_pool_unset`` is the explicit signal that the
  // API Lambda's environment is missing ``COGNITO_USER_POOL_ID``. Map
  // it to ``not_deployed`` so the error card uses the same "fix the
  // infra" affordance as the 404 case, but with the backend's
  // message/hint verbatim.
  if (
    response.status === 503 &&
    typeof body.code === "string" &&
    body.code === "cognito_pool_unset"
  ) {
    return {
      code: "not_deployed",
      status: 503,
      message:
        message ||
        "The backend cannot reach Cognito — COGNITO_USER_POOL_ID is not set on the API Lambda.",
      hint:
        hint ||
        "Run `terraform apply` from /infra and redeploy the API Lambda."
    };
  }
  if (!message && !hint) {
    return classifyAdminReadStatus(response.status, "Request failed.");
  }
  const base = classifyAdminReadStatus(response.status, "Request failed.");
  return {
    code: base.code,
    status: response.status,
    message: message || base.message,
    hint: hint || base.hint
  };
}

export function classifyAdminReadStatus(
  status: number,
  fallbackMessage: string
): AdminApiReadError {
  if (status === 401) {
    return {
      code: "unauthenticated",
      status,
      message: "Your session expired.",
      hint: "Sign out and back in to refresh your credentials."
    };
  }
  if (status === 403) {
    return {
      code: "forbidden",
      status,
      message: "The backend rejected your admin claim.",
      hint:
        "If you were just added to the admin group, sign out and back in so " +
        "your token picks up the `cognito:groups` claim."
    };
  }
  if (status === 404) {
    return {
      code: "not_deployed",
      status,
      message: "The admin API isn't deployed yet on this environment.",
      hint:
        "Run `terraform apply` from /infra and redeploy the API Lambda. " +
        "The route is wired in source but the deployed API Gateway / " +
        "Lambda code is stale."
    };
  }
  if (status >= 500 && status < 600) {
    return {
      code: "upstream_error",
      status,
      message: "The backend returned an error.",
      hint: "Retry; if it persists, check the API Lambda logs in CloudWatch."
    };
  }
  return {
    code: "upstream_error",
    status,
    message: fallbackMessage,
    hint: "Retry; if it persists, check the API Lambda logs in CloudWatch."
  };
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
    last_active_at: string | null;
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
    updated_at: parseStr(raw.updated_at),
    subscription_plan: parseStr(raw.subscription_plan) || "free",
    last_active_at:
      typeof raw.last_active_at === "string" && raw.last_active_at.trim()
        ? raw.last_active_at.trim()
        : null
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
      has_ai_explanations: parseBool(profileRaw.has_ai_explanations),
      last_active_at:
        typeof profileRaw.last_active_at === "string" && profileRaw.last_active_at.trim()
          ? profileRaw.last_active_at.trim()
          : null
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
  const outcome = await searchUsersDiagnostic(query, options);
  return outcome.kind === "ok" ? outcome.data : null;
}

/**
 * Diagnostic variant of {@link searchUsers} that returns either the
 * parsed page or a typed error envelope with the HTTP status and a
 * human-friendly hint. Use this in the Admin Users page so the
 * "Failed to load users" empty state can render an actionable
 * message ("404 — route not deployed; run terraform apply") instead
 * of a generic fallback.
 *
 * The original `null`-on-failure helper is retained for callers that
 * don't need diagnostics (e.g. background refreshes after a
 * mutation); migrate them opportunistically.
 */
export async function searchUsersDiagnostic(
  query: string,
  options: { limit?: number; pageToken?: string | null } = {}
): Promise<AdminApiReadOutcome<AdminUserSearchResponse>> {
  const q = (query ?? "").trim();
  const limit = options.limit && options.limit > 0 ? options.limit : 25;
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  qs.set("limit", String(limit));
  const token = (options.pageToken ?? "").trim();
  if (token) qs.set("page_token", token);
  let response: Response;
  try {
    response = await fetch(`/api/stocvest/admin/users/search?${qs.toString()}`, {
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
    // Read the body so backend-provided ``message`` / ``hint`` (e.g.
    // the 503 ``config_error`` envelope returned when
    // ``COGNITO_USER_POOL_ID`` is unset on the API Lambda) flow into
    // the ``AdminApiErrorCard`` instead of being collapsed to the
    // generic ``classifyAdminReadStatus`` copy. Falls back to the
    // generic envelope when the body is missing / malformed.
    return {
      kind: "error",
      error: await readAdminErrorEnvelope(response)
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
    ? (data.items.map(parseSummaryRow).filter(Boolean) as AdminUserSummaryRow[])
    : [];
  const nextRaw = data.next_token;
  const next_token = typeof nextRaw === "string" && nextRaw.trim() ? nextRaw : null;
  return {
    kind: "ok",
    data: {
      query: parseStr(data.query) || q,
      limit:
        typeof data.limit === "number" && Number.isFinite(data.limit)
          ? data.limit
          : limit,
      items,
      next_token
    }
  };
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

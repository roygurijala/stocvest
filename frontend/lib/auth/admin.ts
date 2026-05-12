import type { AuthSession } from "./types";
import { decodeJwtPayload } from "./session";

/**
 * Cognito group name that grants D10 admin proposal-review access.
 *
 * **Mirrors the backend gate verbatim** —
 * `stocvest/api/services/signal_analysis.py::analysis_authorized` checks for
 * `"signal-analytics-admin"` in the JWT's `cognito:groups` claim. The two
 * names MUST stay in lockstep — if the backend group name ever changes,
 * the constant here moves with it (search for both occurrences).
 */
export const ADMIN_COGNITO_GROUP = "signal-analytics-admin";

/**
 * Defensive container for the cognito:groups claim, which Cognito emits as
 * either a string (legacy / single-group case) or an array of strings. We
 * normalize both shapes to a typed array of strings.
 */
function normalizeCognitoGroups(claim: unknown): string[] {
  if (typeof claim === "string") {
    // Cognito's legacy string form is space-separated; the documented format is
    // actually a JSON array, but defensive parsing also covers the legacy form.
    return claim
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(claim)) {
    return claim.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * Pure function that decides whether a JWT carries the admin group claim.
 *
 * Exported separately from {@link isSessionAdmin} so unit tests can pin the
 * claim-parsing logic without constructing a full {@link AuthSession}.
 *
 * Returns `false` for a missing / malformed / expired token — callers should
 * treat any non-true return as "not admin".
 */
export function isAdminJwt(token: string | null | undefined): boolean {
  if (!token) return false;
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    return false;
  }
  const groups = normalizeCognitoGroups(payload["cognito:groups"]);
  return groups.includes(ADMIN_COGNITO_GROUP);
}

/**
 * Top-level admin check used by the dashboard layout to thread the flag down
 * to the Sidebar + MobileNavDrawer for nav gating, and by the
 * `/dashboard/admin/proposals` server page to decide whether to render the
 * admin surface or redirect away.
 *
 * **This is a frontend convenience check** — the backend gate
 * (`analysis_authorized()`) is the real perimeter and runs on every admin
 * request regardless of what the UI thinks. The frontend check exists only
 * so non-admins don't see a broken page; a malicious user who skips the
 * frontend (e.g. by calling the BFF route directly with a non-admin cookie)
 * still gets a 403 from the backend.
 *
 * Returns `false` for an unauthenticated visitor.
 */
export function isSessionAdmin(session: AuthSession | null): boolean {
  if (!session) return false;
  return isAdminJwt(session.token);
}

/**
 * Tests for `frontend/lib/auth/admin.ts` — the D10 Phase 3b admin gate helper.
 *
 * The helper is a thin convenience layer on top of the JWT's `cognito:groups`
 * claim and **mirrors the backend gate** (`analysis_authorized()` checks for
 * the same `"signal-analytics-admin"` group). The frontend gate exists only
 * so non-admin users don't see a broken page; the backend is always the
 * real perimeter on every API request.
 *
 * Locks in:
 *
 * - `isAdminJwt` recognizes the documented JSON-array form of `cognito:groups`.
 * - It also accepts the legacy comma/space-separated string form.
 * - It rejects malformed tokens, missing claims, and unrelated groups
 *   without throwing.
 * - `isSessionAdmin` returns `false` for `null` sessions (unauthenticated).
 */

import { describe, expect, test } from "vitest";
import { isAdminJwt, isSessionAdmin, ADMIN_COGNITO_GROUP } from "@/lib/auth/admin";
import type { AuthSession } from "@/lib/auth/types";

/**
 * Build a minimal JWT (header.payload.signature) with the given payload.
 *
 * The frontend's `decodeJwtPayload` only base64url-decodes the payload segment
 * and JSON-parses it — no signature verification — so an opaque signature is
 * fine for tests. We keep the header equally opaque to prove the helper does
 * not depend on header contents.
 */
function buildJwt(payload: Record<string, unknown>): string {
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${headerB64}.${payloadB64}.sig-placeholder`;
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildSession(token: string, overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    token,
    subject: "user-1",
    expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
    email: "admin@stocvest.local",
    ...overrides
  };
}

describe("isAdminJwt", () => {
  test("returns true when the array form of cognito:groups contains the admin group", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": ["users", ADMIN_COGNITO_GROUP, "beta"]
    });
    expect(isAdminJwt(token)).toBe(true);
  });

  test("returns false when the array form does not contain the admin group", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": ["users", "beta"]
    });
    expect(isAdminJwt(token)).toBe(false);
  });

  test("accepts the legacy comma-separated string form (defensive)", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": `users, ${ADMIN_COGNITO_GROUP}, beta`
    });
    expect(isAdminJwt(token)).toBe(true);
  });

  test("accepts the legacy space-separated string form (defensive)", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": `users ${ADMIN_COGNITO_GROUP} beta`
    });
    expect(isAdminJwt(token)).toBe(true);
  });

  test("returns false when cognito:groups claim is missing entirely", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600
    });
    expect(isAdminJwt(token)).toBe(false);
  });

  test("returns false when cognito:groups is an unexpected type (number)", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": 42
    });
    expect(isAdminJwt(token)).toBe(false);
  });

  test("returns false when the array contains the admin group as a non-string", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": [{ name: ADMIN_COGNITO_GROUP }]
    });
    expect(isAdminJwt(token)).toBe(false);
  });

  test("returns false for malformed token (single segment)", () => {
    expect(isAdminJwt("not-a-jwt")).toBe(false);
  });

  test("returns false for empty / null / undefined tokens", () => {
    expect(isAdminJwt(null)).toBe(false);
    expect(isAdminJwt(undefined)).toBe(false);
    expect(isAdminJwt("")).toBe(false);
  });

  test("returns false when the payload is not valid JSON", () => {
    const headerB64 = base64UrlEncode(JSON.stringify({ alg: "none" }));
    const payloadB64 = base64UrlEncode("not-json");
    const malformed = `${headerB64}.${payloadB64}.sig`;
    expect(isAdminJwt(malformed)).toBe(false);
  });

  test("is case-sensitive — wrong-case group name does not grant admin", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": ["Signal-Analytics-Admin"]
    });
    expect(isAdminJwt(token)).toBe(false);
  });
});

describe("isSessionAdmin", () => {
  test("returns false for null session (unauthenticated visitor)", () => {
    expect(isSessionAdmin(null)).toBe(false);
  });

  test("returns true when the session's token carries the admin group", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": [ADMIN_COGNITO_GROUP]
    });
    expect(isSessionAdmin(buildSession(token))).toBe(true);
  });

  test("returns false when the session's token has no admin group", () => {
    const token = buildJwt({
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      "cognito:groups": ["users"]
    });
    expect(isSessionAdmin(buildSession(token))).toBe(false);
  });

  test("is robust to a session that holds a malformed token (returns false rather than throwing)", () => {
    expect(isSessionAdmin(buildSession("not-a-jwt"))).toBe(false);
  });
});

describe("ADMIN_COGNITO_GROUP", () => {
  test("matches the backend's analysis_authorized() group name verbatim", () => {
    // Lock-in: if this string ever changes here, the backend's
    // analysis_authorized() must change with it. The frontend gate and the
    // backend gate must stay in lockstep.
    expect(ADMIN_COGNITO_GROUP).toBe("signal-analytics-admin");
  });
});

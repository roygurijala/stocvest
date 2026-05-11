import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `surfaceAuthErrorIfAny` is the fallback path for client fetch helpers that don't go through
 * `browserApiFetch` (fetch-symbol-bars, fetch-symbol-snapshot, fetch-macro-context,
 * ticker-news-panel, public-signals, the assistant). The sliding-session contract is:
 *
 *   - 401 + refresh succeeds → return `true` (caller short-circuits) WITHOUT marking expired.
 *     The user's next interaction picks up the fresh cookie automatically.
 *   - 401 + refresh fails    → return `true` AND mark session expired (calm banner).
 *   - Non-401                → return `false`, no refresh, no banner.
 *   - 403                    → return `false` (product-rule denial; user is still authenticated).
 */

// `vi.mock` is hoisted above all top-level declarations, so the factories cannot reference
// a plain `const` defined here — that would land us in the TDZ. `vi.hoisted` is the supported
// way to share mock instances between the factories and the test bodies.
const { refreshSessionMock, markSessionExpiredMock } = vi.hoisted(() => ({
  refreshSessionMock: vi.fn(async () => true),
  markSessionExpiredMock: vi.fn()
}));

vi.mock("@/lib/auth/refresh-session", () => ({
  refreshSession: refreshSessionMock
}));
vi.mock("@/lib/auth/session-expired", () => ({
  markSessionExpired: markSessionExpiredMock
}));

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

describe("surfaceAuthErrorIfAny — sliding session", () => {
  beforeEach(() => {
    refreshSessionMock.mockReset();
    refreshSessionMock.mockResolvedValue(true);
    markSessionExpiredMock.mockReset();
  });
  afterEach(() => {
    refreshSessionMock.mockReset();
    markSessionExpiredMock.mockReset();
  });

  test("returns false and is a no-op on a null response", async () => {
    const handled = await surfaceAuthErrorIfAny(null);
    expect(handled).toBe(false);
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
  });

  test("returns false and is a no-op on a 200 response", async () => {
    const handled = await surfaceAuthErrorIfAny(new Response("ok", { status: 200 }));
    expect(handled).toBe(false);
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
  });

  test("returns false and is a no-op on a 403 (product-rule denial, NOT auth failure)", async () => {
    const handled = await surfaceAuthErrorIfAny(new Response("forbidden", { status: 403 }));
    expect(handled).toBe(false);
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
  });

  test("on 401 + refresh success — returns true, does NOT mark expired", async () => {
    const handled = await surfaceAuthErrorIfAny(new Response("nope", { status: 401 }));
    expect(handled).toBe(true);
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
  });

  test("on 401 + refresh failure — returns true AND marks session expired", async () => {
    refreshSessionMock.mockResolvedValue(false);
    const handled = await surfaceAuthErrorIfAny(new Response("nope", { status: 401 }));
    expect(handled).toBe(true);
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(markSessionExpiredMock).toHaveBeenCalledWith("auth_error");
  });
});

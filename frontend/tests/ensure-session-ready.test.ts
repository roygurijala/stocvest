import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const { readWsTokenMock, refreshSessionMock } = vi.hoisted(() => ({
  readWsTokenMock: vi.fn(() => "token"),
  refreshSessionMock: vi.fn(async () => true)
}));

vi.mock("@/lib/auth/ws-token-cookie", () => ({
  readWsTokenFromDocumentCookie: readWsTokenMock
}));

vi.mock("@/lib/auth/refresh-session", () => ({
  refreshSession: refreshSessionMock
}));

import { ensureSessionReady } from "@/lib/auth/ensure-session-ready";

function jwtWithExp(expUnix: number): string {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const payload = btoa(JSON.stringify({ exp: expUnix }));
  return `${header}.${payload}.sig`;
}

describe("ensureSessionReady", () => {
  beforeEach(() => {
    readWsTokenMock.mockReset().mockReturnValue("token");
    refreshSessionMock.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns false when mirror cookie is missing", async () => {
    readWsTokenMock.mockReturnValue(null);
    await expect(ensureSessionReady()).resolves.toBe(false);
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  test("refreshes when token is past exp", async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    readWsTokenMock.mockReturnValue(jwtWithExp(exp));
    await expect(ensureSessionReady()).resolves.toBe(true);
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  test("skips refresh when token has ample TTL remaining", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    readWsTokenMock.mockReturnValue(jwtWithExp(exp));
    await expect(ensureSessionReady()).resolves.toBe(true);
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});

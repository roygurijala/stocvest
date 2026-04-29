import { decodeJwtPayload, isSessionExpired, parseSessionFromToken } from "@/lib/auth/session";

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("auth session helpers", () => {
  test("decodeJwtPayload decodes valid payload", () => {
    const token = makeToken({ sub: "user-1", exp: 2_000_000_000 });
    const payload = decodeJwtPayload(token);
    expect(payload.sub).toBe("user-1");
  });

  test("parseSessionFromToken enforces subject and expiry", () => {
    const token = makeToken({ sub: "abc", exp: 1_900_000_000, email: "a@example.com" });
    const session = parseSessionFromToken(token);
    expect(session.subject).toBe("abc");
    expect(session.expiresAtUnix).toBe(1_900_000_000);
    expect(session.email).toBe("a@example.com");
  });

  test("isSessionExpired compares epoch values", () => {
    expect(isSessionExpired(100, 100)).toBe(true);
    expect(isSessionExpired(101, 100)).toBe(false);
  });
});

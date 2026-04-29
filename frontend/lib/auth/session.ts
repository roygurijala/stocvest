import { cookies } from "next/headers";
import type { AuthSession } from "./types";

const DEFAULT_COOKIE_NAME = "stocvest_auth_token";

export function authCookieName(): string {
  return process.env.STOCVEST_AUTH_COOKIE_NAME || DEFAULT_COOKIE_NAME;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const segments = token.split(".");
  if (segments.length < 2) {
    throw new Error("Token must be a JWT.");
  }
  const payloadBase64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = payloadBase64.length % 4;
  const normalized = pad === 0 ? payloadBase64 : payloadBase64 + "=".repeat(4 - pad);
  const payloadJson = Buffer.from(normalized, "base64").toString("utf-8");
  const parsed = JSON.parse(payloadJson);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JWT payload.");
  }
  return parsed as Record<string, unknown>;
}

export function parseSessionFromToken(token: string): AuthSession {
  const payload = decodeJwtPayload(token);
  const sub = payload.sub;
  const exp = payload.exp;
  if (typeof sub !== "string" || !sub) {
    throw new Error("JWT payload missing subject.");
  }
  if (typeof exp !== "number") {
    throw new Error("JWT payload missing expiry.");
  }
  return {
    token,
    subject: sub,
    expiresAtUnix: exp,
    email: typeof payload.email === "string" ? payload.email : undefined
  };
}

export function isSessionExpired(expiresAtUnix: number, nowUnix: number = Date.now() / 1000): boolean {
  return nowUnix >= expiresAtUnix;
}

export function getServerSession(): AuthSession | null {
  const token = cookies().get(authCookieName())?.value;
  if (!token) {
    return null;
  }
  try {
    const session = parseSessionFromToken(token);
    if (isSessionExpired(session.expiresAtUnix)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Unsigned JWT-shaped token for local dev only.
 * Session parsing decodes the payload and does not verify the signature (same as Cognito paste flow).
 */

export function buildDevMockIdToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: "local-dev-user",
      email: "dev@stocvest.local",
      exp: now + 86400 * 365,
      iat: now
    })
  ).toString("base64url");
  return `${header}.${payload}.stocvest-dev-unsigned`;
}

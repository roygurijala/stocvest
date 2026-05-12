import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 4 admin parameter-rollback endpoint —
 * `POST /v1/admin/parameters/rollback` with body `{target_version: string}`.
 *
 * Rollback is the **second** production code path (alongside promote) that
 * mutates the live `stocvest/signal-parameters` Secrets Manager secret
 * under admin authority. The backend handler:
 *
 *   * Gates the call on `analysis_authorized()`.
 *   * Forward-writes a fresh `ParameterHistory` row whose `parameters_json`
 *     payload matches the target version — never reuses the old version
 *     number. The audit trail is monotonic.
 *   * Returns 404 when the target version isn't in `ParameterHistory`.
 *   * Returns 409 when the target version is already live (no-op rollback).
 *   * Returns 500 when the secret save fails or the audit row is corrupt.
 *
 * The request body is forwarded verbatim. An empty body is replaced with
 * `{}` so the backend's JSON parser produces a clean 400 ("target_version
 * is required") rather than a parse error.
 */
export async function POST(req: Request) {
  const incomingBody = await req.text();
  const res = await stocvestAuthedFetch("/v1/admin/parameters/rollback", {
    method: "POST",
    body: incomingBody.length > 0 ? incomingBody : JSON.stringify({})
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

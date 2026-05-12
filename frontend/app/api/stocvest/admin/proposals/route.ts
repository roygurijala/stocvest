import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 3a admin proposal-review list endpoint.
 *
 * Forwards the query string verbatim to `GET /v1/admin/proposals`. The
 * backend handler validates `status` (closed set: pending/promoted/rejected/
 * superseded) and `limit` (clamped to `[1, 100]`) and gates the request
 * through `analysis_authorized()`. This BFF deliberately does no request
 * shaping — it is a thin pipe so the dashboard's typed client owns parsing
 * and the backend owns the contract.
 *
 * 403 responses from the backend (non-admin caller) pass through unchanged
 * so the client can hide the surface rather than treating it as a
 * transient failure.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/admin/proposals${qs ? `?${qs}` : ""}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 4 admin parameter-history list endpoint.
 *
 * Forwards the query string verbatim to `GET /v1/admin/parameters/history`.
 * The backend handler clamps `limit` to `[1, 200]` and gates the request
 * through `analysis_authorized()` (same admin gate as the proposal review
 * surface). The response carries one row per prior parameter rotation —
 * the picker UI on `/dashboard/admin/proposals` renders these as the
 * rollback target list.
 *
 * 403 responses from the backend (non-admin caller) pass through
 * unchanged so the client can hide the surface rather than treating it
 * as a transient failure.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/admin/parameters/history${qs ? `?${qs}` : ""}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

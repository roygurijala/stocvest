import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 3a proposal detail endpoint —
 * `GET /v1/admin/proposals/{proposal_id}` returns the full proposal with
 * evidence and per-mode composite override blocks.
 *
 * Admin gating happens upstream via `analysis_authorized()`; this BFF is
 * a thin status-and-body passthrough so the dashboard's typed client can
 * surface 404 (not found) and 403 (non-admin) verbatim.
 */
export async function GET(
  _req: Request,
  { params }: { params: { proposal_id: string } }
) {
  const path = `/v1/admin/proposals/${encodeURIComponent(params.proposal_id)}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

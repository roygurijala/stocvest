import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 3a proposal **promotion** endpoint —
 * `POST /v1/admin/proposals/{proposal_id}/promote` rotates the live
 * composite weights in Secrets Manager + appends a `ParameterHistory`
 * audit row + marks the proposal `promoted` + auto-supersedes other
 * still-pending proposals.
 *
 * The backend handler emits an `AuditEvent` on success for chain-of-custody;
 * the BFF deliberately stays a thin passthrough so the audit row's
 * `user_id` reflects the admin's Cognito `sub` (forwarded by
 * `stocvestAuthedFetch` via the `Authorization: Bearer` header).
 *
 * Error envelopes from upstream (404 not found / 409 not pending / 500
 * secret save failed) pass through unchanged so the typed client can map
 * them to friendly UI states.
 */
export async function POST(
  _req: Request,
  { params }: { params: { proposal_id: string } }
) {
  const path = `/v1/admin/proposals/${encodeURIComponent(params.proposal_id)}/promote`;
  // The promote endpoint takes no body — it's a unary action keyed by the
  // path param + authenticated admin sub. Setting an empty body keeps
  // `content-type` sane on the API Gateway side.
  const res = await stocvestAuthedFetch(path, {
    method: "POST",
    body: JSON.stringify({})
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

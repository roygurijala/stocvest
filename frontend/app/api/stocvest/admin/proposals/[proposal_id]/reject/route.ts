import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D10 Phase 3a proposal **rejection** endpoint —
 * `POST /v1/admin/proposals/{proposal_id}/reject` transitions the proposal
 * to `rejected` and stamps the admin's `sub` + optional `review_note` on
 * the row. Rejected rows carry a 90-day TTL so the queue doesn't grow.
 *
 * The request body is forwarded verbatim (the backend handler validates
 * the `review_note` field — non-string types map to 400; missing /
 * undefined / null is allowed and stamps no note).
 */
export async function POST(
  req: Request,
  { params }: { params: { proposal_id: string } }
) {
  const path = `/v1/admin/proposals/${encodeURIComponent(params.proposal_id)}/reject`;
  const incomingBody = await req.text();
  const res = await stocvestAuthedFetch(path, {
    method: "POST",
    body: incomingBody.length > 0 ? incomingBody : JSON.stringify({})
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/users/{user_id}/activity-errors`.
 * Forwards the query string (e.g. `days=7`) unchanged.
 */
export async function GET(
  req: Request,
  { params }: { params: { user_id: string } }
) {
  const upstream = new URL(req.url);
  const qs = upstream.searchParams.toString();
  const path = `/v1/admin/users/${encodeURIComponent(params.user_id)}/activity-errors${qs ? `?${qs}` : ""}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

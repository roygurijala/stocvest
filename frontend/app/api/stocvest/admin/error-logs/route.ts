import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/error-logs` (CloudWatch Logs Insights, admin-only).
 * Forwards `days` and `limit` query params verbatim.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/admin/error-logs${qs ? `?${qs}` : ""}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

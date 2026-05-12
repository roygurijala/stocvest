import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/system-status` (aggregated operations
 * snapshot for the admin hub Overview tile).
 */
export async function GET(_req: Request) {
  const res = await stocvestAuthedFetch("/v1/admin/system-status", { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

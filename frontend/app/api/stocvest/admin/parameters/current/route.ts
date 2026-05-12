import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/parameters/current` (read-only snapshot
 * of the live SignalParameters secret). 403 / 500 pass through.
 */
export async function GET(_req: Request) {
  const res = await stocvestAuthedFetch("/v1/admin/parameters/current", {
    method: "GET"
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

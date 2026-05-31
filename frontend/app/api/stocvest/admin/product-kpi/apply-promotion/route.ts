import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** BFF proxy for `POST /v1/admin/product-kpi/apply-promotion`. */
export async function POST(req: Request) {
  const body = await req.text();
  const res = await stocvestAuthedFetch("/v1/admin/product-kpi/apply-promotion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

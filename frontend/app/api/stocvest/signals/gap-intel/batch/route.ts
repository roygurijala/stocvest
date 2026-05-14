import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function POST(req: Request) {
  const body = await req.text();
  const res = await stocvestAuthedFetch("/v1/signals/gap-intel/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

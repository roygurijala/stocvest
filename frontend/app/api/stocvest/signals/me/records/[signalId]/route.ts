import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(_req: Request, ctx: { params: Promise<{ signalId: string }> }) {
  const { signalId } = await ctx.params;
  const id = encodeURIComponent(signalId);
  const res = await stocvestAuthedFetch(`/v1/signals/me/records/${id}`, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

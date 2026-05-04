import { apiBaseUrl } from "@/lib/api/client";

/** Public platform signal detail (no cookie). */
export async function GET(_req: Request, ctx: { params: Promise<{ signalId: string }> }) {
  const { signalId } = await ctx.params;
  const id = encodeURIComponent(signalId);
  const res = await fetch(`${apiBaseUrl()}/v1/signals/records/${id}`, { method: "GET", cache: "no-store" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

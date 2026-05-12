import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/audit/users/{user_id}`. This route was
 * already exposed by the backend (D4 audit-store work) but had no BFF
 * pair until the admin hub shipped — the per-user audit feed renders
 * inside the users-page detail panel.
 */
export async function GET(
  req: Request,
  { params }: { params: { user_id: string } }
) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/admin/audit/users/${encodeURIComponent(params.user_id)}${
    qs ? `?${qs}` : ""
  }`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

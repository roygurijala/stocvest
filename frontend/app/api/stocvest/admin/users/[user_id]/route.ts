import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `GET /v1/admin/users/{user_id}` (Cognito + UserProfile
 * + groups composition). Status + body pass through unchanged.
 */
export async function GET(
  _req: Request,
  { params }: { params: { user_id: string } }
) {
  const path = `/v1/admin/users/${encodeURIComponent(params.user_id)}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

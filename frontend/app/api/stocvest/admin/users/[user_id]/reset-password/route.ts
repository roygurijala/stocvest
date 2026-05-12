import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `POST /v1/admin/users/{user_id}/reset-password`.
 *
 * Triggers a Cognito `AdminResetUserPassword` so the target user gets
 * a fresh "set new password" email. The Cognito call lives in the
 * upstream handler; this route is a thin pass-through. Body is empty —
 * the backend infers the username from the `{user_id}` path param.
 */
export async function POST(
  _req: Request,
  { params }: { params: { user_id: string } }
) {
  const path = `/v1/admin/users/${encodeURIComponent(params.user_id)}/reset-password`;
  const res = await stocvestAuthedFetch(path, { method: "POST", body: "{}" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

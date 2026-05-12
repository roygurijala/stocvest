import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for `PATCH /v1/admin/users/{user_id}/beta-access`.
 *
 * Toggles indefinite beta access for the target user. The admin hub
 * users page calls this with `{ enabled, indefinite }` — the upstream
 * handler is responsible for validating the body, mutating the
 * `UserProfile` row, and emitting the audit event.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { user_id: string } }
) {
  const body = await req.text();
  const path = `/v1/admin/users/${encodeURIComponent(params.user_id)}/beta-access`;
  const res = await stocvestAuthedFetch(path, {
    method: "PATCH",
    body: body || "{}",
    headers: { "content-type": "application/json" }
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxies for the admin Cognito-group mutation endpoints.
 *
 *  * `POST   /v1/admin/users/{user_id}/groups/{group}` — add to group.
 *  * `DELETE /v1/admin/users/{user_id}/groups/{group}` — remove from group.
 *
 * The backend enforces a hard whitelist on `{group}` (today only
 * `signal-analytics-admin`) so this BFF can stay a thin pass-through.
 * A bad group lands as 400 from upstream; auth failures pass through
 * as 403.
 */

type GroupParams = { params: { user_id: string; group: string } };

function upstreamPath(params: GroupParams["params"]): string {
  return `/v1/admin/users/${encodeURIComponent(params.user_id)}/groups/${encodeURIComponent(params.group)}`;
}

export async function POST(_req: Request, { params }: GroupParams) {
  const res = await stocvestAuthedFetch(upstreamPath(params), {
    method: "POST",
    body: "{}"
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

export async function DELETE(_req: Request, { params }: GroupParams) {
  const res = await stocvestAuthedFetch(upstreamPath(params), { method: "DELETE" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json"
    }
  });
}

import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * BFF proxy for the D2 Historical Signal Validation summary endpoint.
 *
 * Forwards the query string verbatim to `GET /v1/signals/historical-validation/summary`
 * (auth required upstream — `stocvestAuthedFetch` attaches the Cognito JWT from the
 * httpOnly cookie). The backend handler already validates `horizon` / `from` / `to`
 * and returns calm `400` envelopes for bad input, so this route deliberately does no
 * request shaping — it is a thin pipe so the dashboard's typed client owns parsing
 * and the backend owns the contract.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const path = `/v1/signals/historical-validation/summary${qs ? `?${qs}` : ""}`;
  const res = await stocvestAuthedFetch(path, { method: "GET" });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" }
  });
}

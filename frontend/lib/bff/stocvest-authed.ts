import { cookies } from "next/headers";
import { authCookieName } from "@/lib/auth/session";
import { apiBaseUrl } from "@/lib/api/client";

/**
 * Server-only fetch to the STOCVEST API with the user's Cognito JWT from cookies.
 */
export async function stocvestAuthedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = cookies().get(authCookieName())?.value;
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(`${apiBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
}

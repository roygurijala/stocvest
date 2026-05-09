"use server";

import { cookies } from "next/headers";
import { apiBaseUrl } from "@/lib/api/client";
import { AGREEMENTS_BUNDLE_VERSION, SIGNUP_LEGAL_COOKIE_NAME } from "@/lib/legal-agreements";

/**
 * After Cognito sign-in, if the user completed the pre-signup agreements step in this
 * browser, persist acknowledgment on the STOCVEST profile (Dynamo) and clear the cookie.
 * Cross-device email verification: cookie may be absent; dashboard legal modal still applies.
 */
export async function persistSignupLegalAckOnLogin(idToken: string): Promise<void> {
  const jar = cookies();
  const pending = jar.get(SIGNUP_LEGAL_COOKIE_NAME)?.value;
  if (pending !== AGREEMENTS_BUNDLE_VERSION) {
    return;
  }
  const base = apiBaseUrl();
  const now = new Date().toISOString();
  try {
    const res = await fetch(`${base}/v1/users/me`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        legal_acknowledged: true,
        legal_acknowledged_version: AGREEMENTS_BUNDLE_VERSION,
        legal_acknowledged_at: now,
      }),
    });
    if (res.ok) {
      jar.delete(SIGNUP_LEGAL_COOKIE_NAME);
    }
  } catch {
    // Keep cookie so a later login can retry (e.g. API cold start).
  }
}

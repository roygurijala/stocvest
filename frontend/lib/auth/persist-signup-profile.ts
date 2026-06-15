import { cookies } from "next/headers";
import { apiBaseUrl } from "@/lib/api/client";
import {
  SIGNUP_PHONE_PREFILL_COOKIE_NAME,
  SIGNUP_PROFILE_COOKIE_MAX_AGE_SEC,
  SIGNUP_PROFILE_COOKIE_NAME,
  decodeSignupProfileCookie,
} from "@/lib/signup-profile";

const COOKIE_OPTS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SIGNUP_PROFILE_COOKIE_MAX_AGE_SEC,
};

/**
 * After Cognito sign-in, if the user completed the signup profile step in this browser,
 * persist names on the STOCVEST profile (Dynamo). Optional phone is kept in a separate
 * cookie for trial verification prefill — not stored on the profile until SMS verified.
 */
export async function persistSignupProfileOnLogin(idToken: string): Promise<void> {
  const jar = cookies();
  const pending = decodeSignupProfileCookie(jar.get(SIGNUP_PROFILE_COOKIE_NAME)?.value);
  if (!pending) {
    return;
  }

  const base = apiBaseUrl();
  const body: Record<string, string | null> = { first_name: pending.first_name };
  if (pending.last_name) {
    body.last_name = pending.last_name;
  }

  try {
    const res = await fetch(`${base}/v1/users/me`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return;
    }

    jar.delete(SIGNUP_PROFILE_COOKIE_NAME);
    if (pending.phone_e164) {
      jar.set(SIGNUP_PHONE_PREFILL_COOKIE_NAME, pending.phone_e164, COOKIE_OPTS);
    }
  } catch {
    // Keep profile cookie so a later login can retry (e.g. API cold start).
  }
}

export function readSignupPhonePrefillFromCookies(): string | null {
  const raw = cookies().get(SIGNUP_PHONE_PREFILL_COOKIE_NAME)?.value?.trim();
  return raw || null;
}

"use server";

import { cookies } from "next/headers";
import { SIGNUP_PHONE_PREFILL_COOKIE_NAME } from "@/lib/signup-profile";

/** Clear phone prefill after successful SMS verification. */
export async function clearSignupPhonePrefillCookie(): Promise<void> {
  cookies().delete(SIGNUP_PHONE_PREFILL_COOKIE_NAME);
}

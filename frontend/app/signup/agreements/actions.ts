"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AGREEMENTS_BUNDLE_VERSION,
  SIGNUP_LEGAL_COOKIE_MAX_AGE_SEC,
  SIGNUP_LEGAL_COOKIE_NAME,
} from "@/lib/legal-agreements";

export interface SignupAgreementsActionState {
  error?: string;
}

const COOKIE_OPTS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SIGNUP_LEGAL_COOKIE_MAX_AGE_SEC,
};

export async function acceptSignupAgreementsAction(
  _prev: SignupAgreementsActionState,
  formData: FormData
): Promise<SignupAgreementsActionState> {
  const accept = formData.get("accept_agreements") === "on";
  if (!accept) {
    return { error: "You must check the box to confirm you agree before continuing." };
  }
  cookies().set(SIGNUP_LEGAL_COOKIE_NAME, AGREEMENTS_BUNDLE_VERSION, COOKIE_OPTS);
  redirect("/signup");
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cognitoErrorMessage, isDuplicateCognitoUsernameError, signUp } from "@/lib/auth/cognito";
import { AGREEMENTS_BUNDLE_VERSION, SIGNUP_LEGAL_COOKIE_NAME } from "@/lib/legal-agreements";
import {
  SIGNUP_PROFILE_COOKIE_MAX_AGE_SEC,
  SIGNUP_PROFILE_COOKIE_NAME,
  encodeSignupProfileCookie,
  normalizePersonName,
  normalizeSignupPhoneE164,
  validateSignupFirstName,
  validateSignupLastName,
  validateSignupPhoneE164,
} from "@/lib/signup-profile";

export interface SignupActionState {
  error?: string;
  /** Email already registered in Cognito — direct user to sign-in or password reset. */
  accountAlreadyExists?: boolean;
  existingEmail?: string;
}

const PROFILE_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SIGNUP_PROFILE_COOKIE_MAX_AGE_SEC,
};

export async function signupAction(_prev: SignupActionState, formData: FormData): Promise<SignupActionState> {
  const jar = cookies();
  if (jar.get(SIGNUP_LEGAL_COOKIE_NAME)?.value !== AGREEMENTS_BUNDLE_VERSION) {
    redirect("/signup/agreements");
  }

  const firstNameRaw = String(formData.get("first_name") || "");
  const lastNameRaw = String(formData.get("last_name") || "");
  const phoneRaw = String(formData.get("phone") || "");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirm_password") || "");

  const firstNameError = validateSignupFirstName(firstNameRaw);
  if (firstNameError) {
    return { error: firstNameError };
  }
  const lastNameError = validateSignupLastName(lastNameRaw);
  if (lastNameError) {
    return { error: lastNameError };
  }
  const phoneError = validateSignupPhoneE164(phoneRaw);
  if (phoneError) {
    return { error: phoneError };
  }

  if (!email || !password || !confirmPassword) {
    return { error: "Please complete all fields." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const profilePayload = {
    first_name: normalizePersonName(firstNameRaw),
    ...(normalizePersonName(lastNameRaw) ? { last_name: normalizePersonName(lastNameRaw) } : {}),
    ...(normalizeSignupPhoneE164(phoneRaw) ? { phone_e164: normalizeSignupPhoneE164(phoneRaw) } : {}),
  };

  try {
    await signUp(email, password);
  } catch (error: unknown) {
    if (isDuplicateCognitoUsernameError(error)) {
      return { accountAlreadyExists: true, existingEmail: email };
    }
    return { error: cognitoErrorMessage(error, "Something went wrong. Please try again.") };
  }

  jar.set(SIGNUP_PROFILE_COOKIE_NAME, encodeSignupProfileCookie(profilePayload), PROFILE_COOKIE_OPTS);
  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

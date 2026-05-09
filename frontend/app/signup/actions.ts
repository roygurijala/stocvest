"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cognitoErrorMessage, isDuplicateCognitoUsernameError, signUp } from "@/lib/auth/cognito";
import { AGREEMENTS_BUNDLE_VERSION, SIGNUP_LEGAL_COOKIE_NAME } from "@/lib/legal-agreements";

export interface SignupActionState {
  error?: string;
  /** Email already registered in Cognito — direct user to sign-in or password reset. */
  accountAlreadyExists?: boolean;
  existingEmail?: string;
}

export async function signupAction(_prev: SignupActionState, formData: FormData): Promise<SignupActionState> {
  const jar = cookies();
  if (jar.get(SIGNUP_LEGAL_COOKIE_NAME)?.value !== AGREEMENTS_BUNDLE_VERSION) {
    redirect("/signup/agreements");
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirm_password") || "");

  if (!email || !password || !confirmPassword) {
    return { error: "Please complete all fields." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  try {
    await signUp(email, password);
  } catch (error: unknown) {
    if (isDuplicateCognitoUsernameError(error)) {
      return { accountAlreadyExists: true, existingEmail: email };
    }
    return { error: cognitoErrorMessage(error, "Something went wrong. Please try again.") };
  }

  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

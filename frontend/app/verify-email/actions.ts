"use server";

import { redirect } from "next/navigation";
import { cognitoErrorMessage, confirmSignUp, resendConfirmationCode } from "@/lib/auth/cognito";

export interface VerifyEmailActionState {
  error?: string;
}

export async function verifyEmailAction(
  _prev: VerifyEmailActionState,
  formData: FormData
): Promise<VerifyEmailActionState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const code = String(formData.get("code") || "").trim();
  if (!email || !code) {
    return { error: "Please enter the verification code." };
  }
  try {
    await confirmSignUp(email, code);
  } catch (error: unknown) {
    return { error: cognitoErrorMessage(error, "Invalid or expired code. Please try again.") };
  }
  redirect("/login?message=Account%20verified.%20Please%20sign%20in.");
}

export async function resendVerificationAction(
  _prev: VerifyEmailActionState,
  formData: FormData
): Promise<VerifyEmailActionState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) {
    return { error: "Missing account email." };
  }
  try {
    await resendConfirmationCode(email);
  } catch {
    return { error: "Unable to resend code right now. Please try again." };
  }
  return { error: "A new verification code has been sent." };
}

"use server";

import { redirect } from "next/navigation";
import { cognitoErrorMessage, forgotPassword } from "@/lib/auth/cognito";

export interface ForgotPasswordActionState {
  error?: string;
}

export async function forgotPasswordAction(
  _prev: ForgotPasswordActionState,
  formData: FormData
): Promise<ForgotPasswordActionState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) {
    return { error: "Email is required." };
  }
  try {
    await forgotPassword(email);
  } catch (error: unknown) {
    return { error: cognitoErrorMessage(error, "Unable to send reset code. Please try again.") };
  }
  redirect(`/reset-password?email=${encodeURIComponent(email)}`);
}

"use server";

import { redirect } from "next/navigation";
import { cognitoErrorMessage, confirmForgotPassword } from "@/lib/auth/cognito";

export interface ResetPasswordActionState {
  error?: string;
}

export async function resetPasswordAction(
  _prev: ResetPasswordActionState,
  formData: FormData
): Promise<ResetPasswordActionState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const code = String(formData.get("code") || "").trim();
  const newPassword = String(formData.get("new_password") || "");
  const confirmPassword = String(formData.get("confirm_password") || "");

  if (!email || !code || !newPassword || !confirmPassword) {
    return { error: "Please complete all fields." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  try {
    await confirmForgotPassword(email, code, newPassword);
  } catch (error: unknown) {
    return { error: cognitoErrorMessage(error, "Unable to reset password. Please try again.") };
  }

  redirect("/login?message=Password%20reset.%20Please%20sign%20in.");
}

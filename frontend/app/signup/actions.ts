"use server";

import { redirect } from "next/navigation";
import { cognitoErrorMessage, signUp } from "@/lib/auth/cognito";

export interface SignupActionState {
  error?: string;
}

export async function signupAction(_prev: SignupActionState, formData: FormData): Promise<SignupActionState> {
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
    return { error: cognitoErrorMessage(error, "Something went wrong. Please try again.") };
  }

  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}

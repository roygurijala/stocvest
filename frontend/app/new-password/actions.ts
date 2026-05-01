"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cognitoErrorMessage, respondToNewPasswordChallenge } from "@/lib/auth/cognito";
import { setSessionTokenCookiesFromIdToken } from "@/lib/auth/session-cookies";

const NEW_PASSWORD_SESSION_COOKIE = "stocvest_new_password_session";
const NEW_PASSWORD_EMAIL_COOKIE = "stocvest_new_password_email";

export interface NewPasswordActionState {
  error?: string;
}

export async function setNewPasswordAction(
  _prev: NewPasswordActionState,
  formData: FormData
): Promise<NewPasswordActionState> {
  const newPassword = String(formData.get("new_password") || "");
  const confirmPassword = String(formData.get("confirm_password") || "");
  if (!newPassword || !confirmPassword) {
    return { error: "Please complete all fields." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const challengeSession = cookies().get(NEW_PASSWORD_SESSION_COOKIE)?.value || "";
  const email = cookies().get(NEW_PASSWORD_EMAIL_COOKIE)?.value || "";
  if (!challengeSession || !email) {
    return { error: "Password challenge expired. Please sign in again." };
  }

  try {
    const result = await respondToNewPasswordChallenge(challengeSession, newPassword, email);
    if (!result.idToken) {
      return { error: "Unable to complete sign in. Please try again." };
    }
    setSessionTokenCookiesFromIdToken(result.idToken);
    cookies().delete(NEW_PASSWORD_SESSION_COOKIE);
    cookies().delete(NEW_PASSWORD_EMAIL_COOKIE);
    redirect("/dashboard");
  } catch (error: unknown) {
    return { error: cognitoErrorMessage(error, "Unable to update password right now.") };
  }
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildDevMockIdToken } from "@/lib/auth/dev-mock-token";
import { cognitoErrorMessage, signIn } from "@/lib/auth/cognito";
import { sanitizeNextPath } from "@/lib/auth/login-redirect";
import { persistSignupLegalAckOnLogin } from "@/lib/auth/persist-signup-legal";
import { clearSessionTokenCookies, setSessionTokenCookiesFromIdToken } from "@/lib/auth/session-cookies";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";

export interface LoginActionState {
  error?: string;
}

const NEW_PASSWORD_SESSION_COOKIE = "stocvest_new_password_session";
const NEW_PASSWORD_EMAIL_COOKIE = "stocvest_new_password_email";

function setAuthCookieFromIdToken(idToken: string): void {
  setSessionTokenCookiesFromIdToken(idToken);
}

/** Read the hidden `next` form input and return a safe, internal path or `/dashboard`. */
function postLoginDestination(formData: FormData): string {
  const raw = formData.get("next");
  const candidate = typeof raw === "string" ? raw : null;
  return sanitizeNextPath(candidate) ?? "/dashboard";
}

export async function loginWithPassword(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const destination = postLoginDestination(formData);

  try {
    const result = await signIn(email, password);

    if (result.idToken) {
      setAuthCookieFromIdToken(result.idToken);
      await persistSignupLegalAckOnLogin(result.idToken);
      redirect(destination);
    }

    if (result.challengeName === "NEW_PASSWORD_REQUIRED" && result.challengeSession) {
      cookies().set(NEW_PASSWORD_SESSION_COOKIE, result.challengeSession, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 10
      });
      cookies().set(NEW_PASSWORD_EMAIL_COOKIE, email, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 10
      });
      redirect("/new-password");
    }

    return { error: "Unable to sign in right now. Please try again." };
  } catch (error: unknown) {
    return { error: cognitoErrorMessage(error, "Unable to sign in right now. Please try again.") };
  }
}

export async function loginAsDevUser(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  if (!isStocvestDevelopment()) {
    return { error: "Dev login is only available when NEXT_PUBLIC_STOCVEST_ENV=development." };
  }
  try {
    setSessionTokenCookiesFromIdToken(buildDevMockIdToken());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Dev login failed.";
    return { error: message };
  }
  redirect(postLoginDestination(formData));
}

export async function logoutAction(): Promise<void> {
  clearSessionTokenCookies();
  redirect("/");
}

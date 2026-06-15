"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildDevMockIdToken } from "@/lib/auth/dev-mock-token";
import { cognitoErrorMessage, signIn } from "@/lib/auth/cognito";
import { sanitizeNextPath } from "@/lib/auth/login-redirect";
import { persistSignupLegalAckOnLogin } from "@/lib/auth/persist-signup-legal";
import { persistSignupProfileOnLogin } from "@/lib/auth/persist-signup-profile";
import { clearSessionTokenCookies, setSessionTokenCookiesFromIdToken } from "@/lib/auth/session-cookies";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";

export interface LoginActionState {
  error?: string;
}

const NEW_PASSWORD_SESSION_COOKIE = "stocvest_new_password_session";
const NEW_PASSWORD_EMAIL_COOKIE = "stocvest_new_password_email";

function setAuthCookieFromIdToken(idToken: string, refreshToken?: string): void {
  setSessionTokenCookiesFromIdToken(idToken, refreshToken);
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
      setAuthCookieFromIdToken(result.idToken, result.refreshToken);
      await persistSignupLegalAckOnLogin(result.idToken);
      await persistSignupProfileOnLogin(result.idToken);
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

/**
 * Server action used by `SessionExpiredBanner` when the user clicks "Sign in".
 *
 * Why this exists (separate from `logoutAction`):
 *
 *   The session-expired banner is rendered from a sticky `sessionStorage` flag
 *   that survives client-side route changes. If the user's underlying Cognito
 *   cookies are STILL valid (which can happen when a single 401 from a single
 *   API call triggered the banner — e.g. a transient JWT-authorizer cache miss
 *   or a stale token mid-rotation), simply navigating to `/login` from the
 *   banner triggers a redirect-loop:
 *
 *     1. `router.push("/login?reason=expired")`
 *     2. `middleware.ts` sees a valid cookie + `pathname.startsWith("/login")`
 *        → redirects back to `/dashboard`.
 *     3. The banner re-renders because the sessionStorage flag is still set.
 *     4. To the user this looks like "I clicked Sign in and nothing happened."
 *
 *   This action breaks the loop by ALWAYS clearing the three session cookies
 *   server-side first, then redirecting to `/login` with `reason=expired` and
 *   the captured `next=` so the user resumes on the page they were on. Once
 *   the cookies are gone, the middleware's `/login while signed in → bounce
 *   to dashboard` branch doesn't fire and the user lands on the login page
 *   cleanly. The login page's `LoginExpiredFlagClear` then scrubs the
 *   sessionStorage flag on render, so the banner can't reappear after the
 *   user signs back in.
 *
 *   We accept the `next` path via form data so the banner doesn't have to
 *   embed it in a query string and so it can be sanitized server-side by the
 *   same `sanitizeNextPath` allowlist every other login redirect uses.
 */
export async function signOutToLoginAction(formData: FormData): Promise<void> {
  const rawNext = formData.get("next");
  const safeNext = sanitizeNextPath(typeof rawNext === "string" ? rawNext : null);
  clearSessionTokenCookies();
  const params = new URLSearchParams();
  params.set("reason", "expired");
  if (safeNext) {
    params.set("next", safeNext);
  }
  redirect(`/login?${params.toString()}`);
}

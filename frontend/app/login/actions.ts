"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildDevMockIdToken } from "@/lib/auth/dev-mock-token";
import { authCookieName, parseSessionFromToken } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";

export interface LoginActionState {
  error?: string;
  challengeName?: "NEW_PASSWORD_REQUIRED";
  challengeSession?: string;
  challengeEmail?: string;
}

const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "2ruog68jh83frp7unduufbvgm2";

function cognitoRegion(): string {
  const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";
  const parsed = poolId.split("_")[0];
  return parsed || "us-east-1";
}

function mapCognitoError(code: string): string {
  if (code === "NotAuthorizedException") return "Incorrect email or password.";
  if (code === "UserNotFoundException") return "No account found with that email.";
  if (code === "TooManyRequestsException" || code === "LimitExceededException") {
    return "Too many failed attempts. Please try again later.";
  }
  return "Unable to sign in right now. Please try again.";
}

async function cognitoRequest<T>(target: string, payload: Record<string, unknown>): Promise<T> {
  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof json.__type === "string" ? json.__type.split("#").pop() || "Unknown" : "Unknown";
    throw new Error(mapCognitoError(code));
  }
  return json as T;
}

function setAuthCookieFromIdToken(idToken: string): void {
  const session = parseSessionFromToken(idToken);
  cookies().set(authCookieName(), session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAtUnix * 1000)
  });
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

  try {
    const result = await cognitoRequest<{
      AuthenticationResult?: { IdToken?: string };
      ChallengeName?: "NEW_PASSWORD_REQUIRED";
      Session?: string;
    }>("AWSCognitoIdentityProviderService.InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    });

    if (result.AuthenticationResult?.IdToken) {
      setAuthCookieFromIdToken(result.AuthenticationResult.IdToken);
      redirect("/dashboard");
    }

    if (result.ChallengeName === "NEW_PASSWORD_REQUIRED" && result.Session) {
      return {
        challengeName: "NEW_PASSWORD_REQUIRED",
        challengeSession: result.Session,
        challengeEmail: email
      };
    }

    return { error: "Sign-in challenge was not recognized. Please try again." };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to sign in right now. Please try again.";
    return { error: message };
  }
}

export async function completeNewPassword(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const emailRaw = formData.get("email");
  const sessionRaw = formData.get("challenge_session");
  const newPasswordRaw = formData.get("new_password");
  const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
  const challengeSession = typeof sessionRaw === "string" ? sessionRaw : "";
  const newPassword = typeof newPasswordRaw === "string" ? newPasswordRaw : "";

  if (!email || !challengeSession || !newPassword) {
    return { error: "Please provide a valid new password." };
  }

  try {
    const result = await cognitoRequest<{ AuthenticationResult?: { IdToken?: string } }>(
      "AWSCognitoIdentityProviderService.RespondToAuthChallenge",
      {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ClientId: COGNITO_CLIENT_ID,
        Session: challengeSession,
        ChallengeResponses: {
          USERNAME: email,
          NEW_PASSWORD: newPassword
        }
      }
    );
    if (!result.AuthenticationResult?.IdToken) {
      return { error: "Could not complete password reset. Please try again." };
    }
    setAuthCookieFromIdToken(result.AuthenticationResult.IdToken);
    redirect("/dashboard");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to update password right now.";
    return { error: message };
  }
}

export async function loginAsDevUser(
  _prev: LoginActionState,
  _formData: FormData
): Promise<LoginActionState> {
  if (!isStocvestDevelopment()) {
    return { error: "Dev login is only available when NEXT_PUBLIC_STOCVEST_ENV=development." };
  }
  let session;
  try {
    session = parseSessionFromToken(buildDevMockIdToken());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Dev login failed.";
    return { error: message };
  }
  cookies().set(authCookieName(), session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(session.expiresAtUnix * 1000)
  });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  cookies().delete(authCookieName());
  redirect("/login");
}

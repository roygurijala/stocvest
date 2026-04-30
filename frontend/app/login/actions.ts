"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildDevMockIdToken } from "@/lib/auth/dev-mock-token";
import { authCookieName, parseSessionFromToken } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";

export interface LoginActionState {
  error?: string;
}

export async function loginWithToken(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const tokenRaw = formData.get("id_token");
  if (typeof tokenRaw !== "string" || !tokenRaw.trim()) {
    return { error: "ID token is required." };
  }
  let session;
  try {
    session = parseSessionFromToken(tokenRaw.trim());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid token.";
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

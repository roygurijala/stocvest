"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authCookieName, parseSessionFromToken } from "@/lib/auth/session";

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
  try {
    const session = parseSessionFromToken(tokenRaw.trim());
    cookies().set(authCookieName(), session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(session.expiresAtUnix * 1000)
    });
    redirect("/dashboard");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid token.";
    return { error: message };
  }
}

export async function logoutAction(): Promise<void> {
  cookies().delete(authCookieName());
  redirect("/login");
}

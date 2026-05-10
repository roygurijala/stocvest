"use client";

import { useEffect } from "react";
import { clearSessionExpired } from "@/lib/auth/session-expired";

/**
 * Clears the client-side `stocvest_session_expired` flag whenever the user reaches the login page.
 *
 * Without this, the `SessionExpiredBanner` could reappear briefly after a successful sign-in if the
 * sessionStorage flag survived the navigation. The login page is the natural place to scrub it
 * because by definition the user is taking action on the expired session.
 */
export function LoginExpiredFlagClear() {
  useEffect(() => {
    clearSessionExpired();
  }, []);
  return null;
}

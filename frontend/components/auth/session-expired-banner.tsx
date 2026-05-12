"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { signOutToLoginAction } from "@/app/login/actions";
import {
  clearSessionExpired,
  isSessionExpiredFlagSet,
  subscribeSessionExpired
} from "@/lib/auth/session-expired";

/**
 * Calm, fixed-position bar that appears once the session is detected as expired (proactive watcher
 * timer or reactive 401/403 from a fetch helper).
 *
 * UX contract:
 *   - Does NOT redirect on its own — the user can still read cached data on the page.
 *   - Primary action is a "Sign in" button rendered as a `<form action={signOutToLoginAction}>`.
 *     This is intentional: clicking it must **always** terminate the current session
 *     server-side before navigating to `/login`. If we used a client-side `router.push("/login")`
 *     and the user's Cognito cookies were still valid (which CAN happen — the banner is driven
 *     by a sessionStorage flag that may have been set by a single 401 on a transient API hiccup),
 *     the middleware's "/login while signed in → bounce to dashboard" branch would bounce the
 *     user right back, the banner would re-render from the still-set flag, and the user would
 *     experience "nothing happens when I click Sign in." The server action sidesteps that
 *     redirect loop by clearing the auth cookies before the browser ever reaches `/login`.
 *   - Hidden on the login page (the user is already there).
 *   - Re-renders on client-side route changes within the dashboard so it survives navigation.
 *
 * The hidden `next` input carries the page the user was on so the login redirect chain can
 * resume them there after sign-in. `sanitizeNextPath` (called inside the server action) ensures
 * this can't be abused as an open redirect.
 */
export function SessionExpiredBanner() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    setVisible(isSessionExpiredFlagSet());
    const unsub = subscribeSessionExpired(() => setVisible(true));
    return unsub;
  }, []);

  if (!visible) return null;
  if (pathname?.startsWith("/login")) return null;

  const search = searchParams?.toString() ?? "";
  const currentPath = pathname ? `${pathname}${search ? `?${search}` : ""}` : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-3"
    >
      <div className="pointer-events-auto flex w-full max-w-3xl items-start gap-3 rounded-md border border-amber-500/40 bg-[#1f1407] px-4 py-2.5 text-sm text-amber-100 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <div className="flex-1">
          <p className="m-0 font-medium">Your session has expired.</p>
          <p className="m-0 mt-0.5 text-xs text-amber-200/80">
            Sign in again to continue. You can still view what is on screen until you do.
          </p>
        </div>
        <form
          action={signOutToLoginAction}
          // Clear the sticky sessionStorage flag eagerly so the banner can't
          // re-fire during the brief flicker between this submit and the
          // server-side redirect landing on `/login`. The login page also
          // calls `clearSessionExpired()` on render as a belt-and-suspenders.
          onSubmit={() => {
            clearSessionExpired();
          }}
        >
          <input type="hidden" name="next" value={search ? `${pathname}?${search}` : currentPath} />
          <button
            type="submit"
            className="min-h-9 shrink-0 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

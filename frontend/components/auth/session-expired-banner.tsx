"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { loginRedirectPath } from "@/lib/auth/login-redirect";
import {
  isSessionExpiredFlagSet,
  subscribeSessionExpired
} from "@/lib/auth/session-expired";

/**
 * Calm, fixed-position bar that appears once the session is detected as expired (proactive watcher
 * timer or reactive 401/403 from a fetch helper).
 *
 * UX contract:
 *   - Does NOT redirect on its own — the user can still read cached data on the page.
 *   - Primary action is a "Sign in" button that navigates to `/login?reason=expired&next=<path>`.
 *   - Hidden on the login page (the user is already there).
 *   - Re-renders on client-side route changes within the dashboard so it survives navigation.
 */
export function SessionExpiredBanner() {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    setVisible(isSessionExpiredFlagSet());
    const unsub = subscribeSessionExpired(() => setVisible(true));
    return unsub;
  }, []);

  if (!visible) return null;
  if (pathname?.startsWith("/login")) return null;

  const search = searchParams?.toString() ?? "";
  const currentPath = pathname ? `${pathname}${search ? `?${search}` : ""}` : null;
  const loginHref = loginRedirectPath("expired", currentPath);

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
        <button
          type="button"
          onClick={() => router.push(loginHref)}
          className="min-h-9 shrink-0 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

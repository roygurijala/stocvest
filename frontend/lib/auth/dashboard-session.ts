import { getServerSession } from "./session";
import { isSessionAdmin } from "./admin";
import type { AuthSession } from "./types";

/**
 * Server-side helper that resolves the dashboard auth context in one call.
 *
 * Every dashboard page server component does the same three steps:
 *
 * 1. `getServerSession()` to read the JWT from the auth cookie.
 * 2. `isSessionAdmin(session)` to decide whether to render admin nav.
 * 3. Pass both to `<AppShell session={session} isAdmin={isAdmin}>`.
 *
 * Centralizing the pair means a future change (e.g. adding a "support
 * agent" role or threading additional flags through to the shell) is one
 * edit, not 15.
 *
 * The frontend admin flag is a UX convenience only — the backend gate
 * (`analysis_authorized()`) is the real perimeter and runs on every admin
 * API request regardless of what `isAdmin` says here.
 */
export function getDashboardAuthContext(): {
  session: AuthSession | null;
  isAdmin: boolean;
} {
  const session = getServerSession();
  return { session, isAdmin: isSessionAdmin(session) };
}

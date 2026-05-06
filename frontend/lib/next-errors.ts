/** True when Next.js App Router threw from `redirect()` — must propagate, never stringify for UI fallbacks. */
export function isNextRedirect(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (digest === "NEXT_REDIRECT") return true;
  return error instanceof Error && error.message === "NEXT_REDIRECT";
}

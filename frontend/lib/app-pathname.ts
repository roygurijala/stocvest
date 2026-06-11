/** Normalize Next.js pathnames for route matching (strip trailing slashes). */
export function normalizeAppPathname(pathname: string | null | undefined): string {
  if (!pathname) return "";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

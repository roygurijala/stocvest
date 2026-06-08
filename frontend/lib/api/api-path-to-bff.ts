/**
 * Map upstream API paths (`/v1/...`) to same-origin Next.js BFF routes.
 * Client Components must not call API Gateway directly — localhost CORS blocks it.
 */
export function apiPathToBffUrl(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/v1/")) return null;
  return `/api/stocvest${trimmed.slice(3)}`;
}

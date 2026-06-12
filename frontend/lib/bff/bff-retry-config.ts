/** Shared retry policy for BFF read routes (server) and browser fetches (client). */

export const UPSTREAM_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export const BFF_READ_MAX_ATTEMPTS = 3;
export const BFF_READ_RETRY_BASE_MS = 600;

export function isUpstreamUnavailable(status: number): boolean {
  return UPSTREAM_UNAVAILABLE_STATUSES.has(status);
}

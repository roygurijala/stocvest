/**
 * Timeout + soft-failure helpers for dashboard RSC fetches (Tier 1.C Phase 5).
 */

import { isNextRedirect } from "@/lib/next-errors";

/** Resolve `fallback` when `promise` exceeds `ms` or rejects (redirects propagate). */
export function timeoutFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (isNextRedirect(err)) {
          reject(err);
          return;
        }
        resolve(fallback);
      });
  });
}

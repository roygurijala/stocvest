/**
 * US equity ticker normalization for manual entry + Polygon search results.
 *
 * Mirrors ``stocvest/data/symbol_normalize.py`` (dash class-shares → dot).
 * Canonical wire/display form for class shares is ``BRK.B`` (not ``BRK-B``).
 */

const CLASS_SHARE_DASH = /^([A-Z]{1,8})-([A-Z])$/;
const PLAIN_TICKER = /^[A-Z]{1,6}$/;
const CLASS_SHARE_DOT = /^[A-Z]{1,8}\.[A-Z]{1,2}$/;

/** Conservative manual-entry + API parse (returns canonical uppercase ticker or null). */
export function canonicalUsTicker(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  if (PLAIN_TICKER.test(u)) return u;
  if (CLASS_SHARE_DOT.test(u)) return u;
  const dash = CLASS_SHARE_DASH.exec(u);
  if (dash) return `${dash[1]}.${dash[2]}`;
  return null;
}

/** Slightly permissive parse for Polygon reference rows before canonicalization. */
export function canonicalUsTickerFromSearch(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  const narrow = canonicalUsTicker(u);
  if (narrow) return narrow;
  if (/^[A-Z]{1,10}$/.test(u)) return u;
  if (/^[A-Z0-9]{1,8}\.[A-Z]{1,3}$/.test(u)) return u;
  const dash = CLASS_SHARE_DASH.exec(u);
  if (dash) return `${dash[1]}.${dash[2]}`;
  return null;
}

export function tickersEquivalent(a: string, b: string): boolean {
  const ca = canonicalUsTicker(a) ?? canonicalUsTickerFromSearch(a);
  const cb = canonicalUsTicker(b) ?? canonicalUsTickerFromSearch(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

/** True when user typed a well-formed US ticker (commit without corroboration). */
export function isWellFormedUsTicker(raw: string): boolean {
  return canonicalUsTicker(raw) != null;
}

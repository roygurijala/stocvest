/**
 * Single bundle version for Terms of Service + Privacy Policy + risk disclosure
 * presented at registration. Bump when legal copy changes materially; keep in sync
 * with `stocvest/config/legal_versions.py` for backend checks.
 */
export const AGREEMENTS_BUNDLE_VERSION = "2026-05-08";

/** httpOnly cookie: user completed pre-signup agreements flow (same browser). */
export const SIGNUP_LEGAL_COOKIE_NAME = "stocvest_signup_legal";

/** Max age while user may verify email before first login (14 days). */
export const SIGNUP_LEGAL_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

export function agreementsBundleLabel(): string {
  return `Agreements v${AGREEMENTS_BUNDLE_VERSION}`;
}

/** Documents included in the signup bundle (same version string applies to all). */
export const AGREEMENTS_DOCUMENT_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/legal/risk-disclosure", label: "Risk disclosure" },
];

/** Query key: legal pages loaded in the signup drawer iframe append this to hide exit links. */
export const SIGNUP_LEGAL_EMBED_PARAM = "signupEmbed";

export function isSignupLegalEmbedSearch(raw?: Record<string, string | string[] | undefined>): boolean {
  if (!raw) return false;
  const v = raw[SIGNUP_LEGAL_EMBED_PARAM];
  const s = Array.isArray(v) ? v[0] : v;
  return s === "1" || s === "true";
}

/** Use for iframe `src` so embedded legal pages can detect embed mode. */
export function withSignupLegalEmbed(path: string): string {
  if (path.includes(`${SIGNUP_LEGAL_EMBED_PARAM}=`)) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${SIGNUP_LEGAL_EMBED_PARAM}=1`;
}

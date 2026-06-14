/**
 * Pre-signup profile fields collected on the account step and persisted to Dynamo
 * on first successful sign-in (same browser session as registration).
 */

export const SIGNUP_PROFILE_COOKIE_NAME = "stocvest_signup_profile";
export const SIGNUP_PHONE_PREFILL_COOKIE_NAME = "stocvest_signup_phone_prefill";

/** Max age while user may verify email before first login (14 days). */
export const SIGNUP_PROFILE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

export const SIGNUP_NAME_MAX_LEN = 60;

/** E.164: leading +, country code, 8–15 digits total. */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export interface SignupProfilePending {
  first_name: string;
  last_name?: string;
  phone_e164?: string;
}

export function normalizePersonName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function validateSignupFirstName(raw: string): string | null {
  const name = normalizePersonName(raw);
  if (!name) return "First name is required.";
  if (name.length > SIGNUP_NAME_MAX_LEN) return `First name must be ${SIGNUP_NAME_MAX_LEN} characters or fewer.`;
  return null;
}

export function validateSignupLastName(raw: string): string | null {
  const name = normalizePersonName(raw);
  if (!name) return null;
  if (name.length > SIGNUP_NAME_MAX_LEN) return `Last name must be ${SIGNUP_NAME_MAX_LEN} characters or fewer.`;
  return null;
}

export function normalizeSignupPhoneE164(raw: string): string {
  const compact = raw.trim().replace(/[\s()-]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return compact.startsWith("+") ? compact : `+${digits}`;
}

export function validateSignupPhoneE164(raw: string): string | null {
  const phone = normalizeSignupPhoneE164(raw);
  if (!phone) return null;
  if (!E164_RE.test(phone)) {
    return "Enter a valid mobile number in international format (e.g. +1 555 123 4567).";
  }
  return null;
}

export function encodeSignupProfileCookie(profile: SignupProfilePending): string {
  return Buffer.from(JSON.stringify(profile), "utf8").toString("base64url");
}

export function decodeSignupProfileCookie(raw: string | undefined): SignupProfilePending | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SignupProfilePending;
    const first = normalizePersonName(parsed.first_name ?? "");
    if (!first) return null;
    const out: SignupProfilePending = { first_name: first };
    const last = normalizePersonName(parsed.last_name ?? "");
    if (last) out.last_name = last;
    const phone = normalizeSignupPhoneE164(parsed.phone_e164 ?? "");
    if (phone && E164_RE.test(phone)) out.phone_e164 = phone;
    return out;
  } catch {
    return null;
  }
}

import { describe, expect, it } from "vitest";
import {
  decodeSignupProfileCookie,
  encodeSignupProfileCookie,
  normalizeSignupPhoneE164,
  validateSignupFirstName,
  validateSignupPhoneE164,
} from "@/lib/signup-profile";

describe("signup-profile", () => {
  it("requires first name", () => {
    expect(validateSignupFirstName("")).toMatch(/required/i);
    expect(validateSignupFirstName("  Alex  ")).toBeNull();
  });

  it("normalizes US phone numbers to E.164", () => {
    expect(normalizeSignupPhoneE164("(555) 123-4567")).toBe("+15551234567");
    expect(validateSignupPhoneE164("+15551234567")).toBeNull();
  });

  it("round-trips profile cookie payload", () => {
    const encoded = encodeSignupProfileCookie({
      first_name: "Alex",
      last_name: "Rivera",
      phone_e164: "+15551234567",
    });
    const decoded = decodeSignupProfileCookie(encoded);
    expect(decoded).toEqual({
      first_name: "Alex",
      last_name: "Rivera",
      phone_e164: "+15551234567",
    });
  });
});

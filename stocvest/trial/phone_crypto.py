"""Phone normalization, HMAC fingerprinting, and OTP hashing."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Final

_E164_RE: Final[re.Pattern[str]] = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_e164(raw: str) -> str | None:
    """Return canonical E.164 (+15551234567) or None if invalid."""
    s = str(raw or "").strip()
    if not s:
        return None
    # Strip common formatting; require leading + after cleanup.
    cleaned = re.sub(r"[\s().-]", "", s)
    if not cleaned.startswith("+"):
        if cleaned.isdigit() and len(cleaned) == 10:
            cleaned = f"+1{cleaned}"
        elif cleaned.isdigit() and len(cleaned) == 11 and cleaned.startswith("1"):
            cleaned = f"+{cleaned}"
        else:
            return None
    if not _E164_RE.match(cleaned):
        return None
    return cleaned


def phone_last4(e164: str) -> str:
    digits = re.sub(r"\D", "", e164)
    return digits[-4:] if len(digits) >= 4 else digits


def phone_hmac(e164: str, *, pepper: str) -> str:
    """One-way phone fingerprint for dedup ledger (never store raw phone on profile)."""
    p = str(pepper or "").strip()
    if not p:
        raise ValueError("TRIAL_PHONE_HMAC_PEPPER is required for phone verification.")
    normalized = normalize_e164(e164)
    if not normalized:
        raise ValueError("Invalid phone number.")
    digest = hmac.new(p.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest


def generate_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str, *, pepper: str, user_id: str) -> str:
    p = str(pepper or "").strip()
    if not p:
        raise ValueError("TRIAL_PHONE_HMAC_PEPPER is required for OTP hashing.")
    payload = f"{user_id}:{code.strip()}".encode("utf-8")
    return hmac.new(p.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_otp(code: str, *, expected_hash: str, pepper: str, user_id: str) -> bool:
    try:
        candidate = hash_otp(code, pepper=pepper, user_id=user_id)
    except ValueError:
        return False
    return hmac.compare_digest(candidate, expected_hash)

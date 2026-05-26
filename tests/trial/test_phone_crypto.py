"""Phone crypto helpers."""

from __future__ import annotations

import pytest

from stocvest.trial.phone_crypto import (
    generate_otp_code,
    hash_otp,
    normalize_e164,
    phone_hmac,
    verify_otp,
)


def test_normalize_e164_us_formats() -> None:
    assert normalize_e164("+15551234567") == "+15551234567"
    assert normalize_e164("(555) 123-4567") == "+15551234567"
    assert normalize_e164("5551234567") == "+15551234567"


def test_normalize_e164_rejects_invalid() -> None:
    assert normalize_e164("") is None
    assert normalize_e164("abc") is None


def test_phone_hmac_stable() -> None:
    a = phone_hmac("+15551234567", pepper="pepper")
    b = phone_hmac("+15551234567", pepper="pepper")
    assert a == b
    assert a != phone_hmac("+15559876543", pepper="pepper")


def test_otp_hash_and_verify() -> None:
    code = generate_otp_code()
    assert len(code) == 6
    h = hash_otp(code, pepper="pepper", user_id="user-1")
    assert verify_otp(code, expected_hash=h, pepper="pepper", user_id="user-1")
    assert not verify_otp("000000", expected_hash=h, pepper="pepper", user_id="user-1")


def test_phone_hmac_requires_pepper() -> None:
    with pytest.raises(ValueError):
        phone_hmac("+15551234567", pepper="")

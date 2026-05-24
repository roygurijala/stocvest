"""Best-effort SNS SMS for trial OTP (no-op when disabled)."""

from __future__ import annotations

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def send_trial_otp_sms(*, phone_e164: str, code: str) -> None:
    settings = get_settings()
    if not settings.trial_sms_enabled:
        _LOG.info("trial_otp_sms_skipped phone=%s (TRIAL_SMS_ENABLED=false)", _mask_phone(phone_e164))
        return
    try:
        import boto3

        client = boto3.client("sns", region_name=settings.aws_region)
        client.publish(
            PhoneNumber=phone_e164,
            Message=f"Your Stocvest verification code is {code}. It expires in 10 minutes.",
            MessageAttributes={
                "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
            },
        )
    except Exception:
        _LOG.exception("trial_otp_sms_failed phone=%s", _mask_phone(phone_e164))
        raise


def _mask_phone(e164: str) -> str:
    s = str(e164 or "")
    if len(s) <= 4:
        return "****"
    return f"{'*' * (len(s) - 4)}{s[-4:]}"

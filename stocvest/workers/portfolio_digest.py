"""Daily post-close portfolio digest — emails each opted-in holder their review.

PORTFOLIO-MGMT Slice 3a. Runs after market close (EventBridge → the `portfolio_review`
Lambda with ``{ portfolio_digest_tick: true }``). For every user who holds at least one
manual holding AND has opted in (``AlertPreferences.email_enabled`` +
``on_portfolio_digest``), it builds the deterministic portfolio review and sends a
Postmark digest — mirroring the trial-reminder tick (`stocvest/trial/reminders.py`).

Gated by ``PORTFOLIO_DIGEST_ENABLED`` (default OFF) so it ships dark. Financial data
(prices/cost/cash) is never logged — only counts and truncated user refs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from stocvest.api.services.holdings_store import HoldingsStore, get_holdings_store
from stocvest.api.services.portfolio_review import build_portfolio_review_sync
from stocvest.api.services.user_profile_store import UserProfileStore, get_user_profile_store
from stocvest.data.alert_store import get_alert_store
from stocvest.models.portfolio_holding import PortfolioHolding, PortfolioSettings
from stocvest.services.email_service import EmailService
from stocvest.trial.user_directory import resolve_user_email
from stocvest.utils.config import get_settings
from stocvest.utils.log_privacy import user_ref_for_logs
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Injectable review builder → PortfolioReview.to_api() dict (kept for offline tests).
ReviewBuilder = Callable[..., dict[str, Any]]


@dataclass(frozen=True)
class PortfolioDigestResult:
    scanned: int
    sent: int
    skipped_not_opted_in: int
    skipped_no_email: int
    errors: int


def _default_review_builder(
    *, holdings: tuple[PortfolioHolding, ...], settings: PortfolioSettings, user_id: str, user_email: str | None
) -> dict[str, Any]:
    review = build_portfolio_review_sync(
        holdings=holdings, settings=settings, user_id=user_id, user_email=user_email
    )
    return review.to_api()


def run_portfolio_digest_tick(
    *,
    holdings_store: HoldingsStore | None = None,
    profile_store: UserProfileStore | None = None,
    alert_store: Any = None,
    email_service: EmailService | None = None,
    review_builder: ReviewBuilder | None = None,
) -> PortfolioDigestResult:
    settings = get_settings()
    if not settings.portfolio_digest_enabled:
        _LOG.info("portfolio_digest_skipped PORTFOLIO_DIGEST_ENABLED=false")
        return PortfolioDigestResult(0, 0, 0, 0, 0)

    hstore = holdings_store or get_holdings_store()
    pstore = profile_store or get_user_profile_store()
    astore = alert_store or get_alert_store()
    mailer = email_service or EmailService()
    build_review = review_builder or _default_review_builder

    scanned = sent = not_opted = no_email = errors = 0

    for user_id in hstore.iter_users_with_holdings():
        scanned += 1
        try:
            prefs = astore.get_preferences(user_id)
            if not prefs.email_enabled or not prefs.on_portfolio_digest:
                not_opted += 1
                continue

            profile = pstore.get_profile(user_id)
            email = resolve_user_email(profile) if profile is not None else None
            if not email:
                no_email += 1
                continue

            holdings = hstore.list_holdings(user_id)
            if not holdings:
                continue
            portfolio_settings = hstore.get_settings(user_id)
            review = build_review(
                holdings=holdings,
                settings=portfolio_settings,
                user_id=user_id,
                user_email=email,
            )
            if mailer.send_portfolio_digest_email(to_email=email, review=review):
                sent += 1
            else:
                errors += 1
        except Exception:
            _LOG.exception("portfolio_digest_failed user=%s", user_ref_for_logs(user_id))
            errors += 1

    _LOG.info(
        "portfolio_digest_tick scanned=%s sent=%s not_opted_in=%s no_email=%s errors=%s",
        scanned, sent, not_opted, no_email, errors,
    )
    return PortfolioDigestResult(scanned, sent, not_opted, no_email, errors)


def portfolio_digest_handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    result = run_portfolio_digest_tick()
    return {
        "statusCode": 200,
        "scanned": result.scanned,
        "sent": result.sent,
        "skipped_not_opted_in": result.skipped_not_opted_in,
        "skipped_no_email": result.skipped_no_email,
        "errors": result.errors,
    }

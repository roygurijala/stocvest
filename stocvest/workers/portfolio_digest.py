"""Daily post-close portfolio digest — emails each opted-in holder their review.

PORTFOLIO-MGMT Slice 3a. Runs after market close (EventBridge → the `portfolio_review`
Lambda with ``{ portfolio_digest_tick: true }``). For every user who holds at least one
manual holding AND has opted in (``AlertPreferences.email_enabled`` +
``on_portfolio_digest``), it builds the deterministic portfolio review and sends a
Postmark digest — mirroring the trial-reminder tick (`stocvest/trial/reminders.py`).

Gated by ``PORTFOLIO_DIGEST_ENABLED`` (default OFF) so it ships dark, and by
``stocvest_personal_advice_mode_enabled`` (the legal basis for buy/sell language — the
digest is advisory, so it does not send when personal-advice mode is off). Idempotent:
each user is skipped once ``last_portfolio_digest_date`` == today, so scheduler retries
or double-fires never double-send. Financial data (prices/cost/cash) is never logged —
only counts and truncated user refs.

Scale note: within one run, the benchmark daily-bars fetch is memoized per
``(symbol, from_date)`` and the position-scan snapshot is already cached, so users
sharing a benchmark don't each re-fetch. Heavy per-user composites still run inline;
fan-out (SQS) is the future step if the holder base grows large.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
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
    skipped_already_sent: int
    errors: int


def _make_default_review_builder() -> ReviewBuilder:
    """Build a review builder whose benchmark daily-bars fetch is memoized for this run.

    Users sharing a benchmark (the common case — SPY) then trigger a single bars fetch
    instead of one per user. The position-scan snapshot used for "consider adding" is
    already process-cached, so it is not re-fetched per user either.
    """
    from stocvest.api.services.portfolio_review import _default_spy_bars  # local: prod provider

    bars_cache: dict[tuple[str, date], list[Any]] = {}

    async def _cached_spy_bars(symbol: str, from_date: date) -> list[Any]:
        key = (symbol.upper(), from_date)
        hit = bars_cache.get(key)
        if hit is not None:
            return hit
        bars = await _default_spy_bars(symbol, from_date)
        bars_cache[key] = bars
        return bars

    def _build(
        *,
        holdings: tuple[PortfolioHolding, ...],
        settings: PortfolioSettings,
        user_id: str,
        user_email: str | None,
    ) -> dict[str, Any]:
        review = build_portfolio_review_sync(
            holdings=holdings,
            settings=settings,
            user_id=user_id,
            user_email=user_email,
            spy_bars_fn=_cached_spy_bars,
        )
        return review.to_api()

    return _build


def run_portfolio_digest_tick(
    *,
    holdings_store: HoldingsStore | None = None,
    profile_store: UserProfileStore | None = None,
    alert_store: Any = None,
    email_service: EmailService | None = None,
    review_builder: ReviewBuilder | None = None,
    now: datetime | None = None,
) -> PortfolioDigestResult:
    settings = get_settings()
    if not settings.portfolio_digest_enabled:
        _LOG.info("portfolio_digest_skipped PORTFOLIO_DIGEST_ENABLED=false")
        return PortfolioDigestResult(0, 0, 0, 0, 0, 0)
    if not settings.stocvest_personal_advice_mode_enabled:
        # The digest is advisory (buy/hold/trim/sell) — do not send when personal-advice
        # mode is off (the required posture before any external release).
        _LOG.info("portfolio_digest_skipped personal_advice_mode=off")
        return PortfolioDigestResult(0, 0, 0, 0, 0, 0)

    hstore = holdings_store or get_holdings_store()
    pstore = profile_store or get_user_profile_store()
    astore = alert_store or get_alert_store()
    mailer = email_service or EmailService()
    build_review = review_builder or _make_default_review_builder()
    today_iso = (now or datetime.now(timezone.utc)).date().isoformat()

    scanned = sent = not_opted = no_email = already_sent = errors = 0

    for user_id in hstore.iter_users_with_holdings():
        scanned += 1
        try:
            prefs = astore.get_preferences(user_id)
            if not prefs.email_enabled or not prefs.on_portfolio_digest:
                not_opted += 1
                continue

            profile = pstore.get_profile(user_id)
            # Idempotency: skip if we already sent today (scheduler retry / double-fire).
            if profile is not None and profile.last_portfolio_digest_date == today_iso:
                already_sent += 1
                continue

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
                # Mark sent BEFORE the next user so a later timeout can't cause a re-send.
                if profile is not None:
                    try:
                        pstore.put_profile(
                            profile.model_copy(update={"last_portfolio_digest_date": today_iso})
                        )
                    except Exception:  # noqa: BLE001 — marking is best-effort
                        _LOG.warning(
                            "portfolio_digest_mark_failed user=%s", user_ref_for_logs(user_id)
                        )
            else:
                errors += 1
        except Exception:
            _LOG.exception("portfolio_digest_failed user=%s", user_ref_for_logs(user_id))
            errors += 1

    _LOG.info(
        "portfolio_digest_tick scanned=%s sent=%s not_opted_in=%s no_email=%s "
        "already_sent=%s errors=%s",
        scanned, sent, not_opted, no_email, already_sent, errors,
    )
    return PortfolioDigestResult(scanned, sent, not_opted, no_email, already_sent, errors)


def portfolio_digest_handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    result = run_portfolio_digest_tick()
    return {
        "statusCode": 200,
        "scanned": result.scanned,
        "sent": result.sent,
        "skipped_not_opted_in": result.skipped_not_opted_in,
        "skipped_no_email": result.skipped_no_email,
        "skipped_already_sent": result.skipped_already_sent,
        "errors": result.errors,
    }

"""Portfolio review endpoint — the daily "manage my portfolio" read.

``GET /v1/portfolio-review`` — user-scoped. Loads the caller's manually-entered
holdings + settings and returns the deterministic per-holding review
(Hold / Buy-more / Trim / Sell) plus concentration flags, a money-weighted
benchmark-vs-SPY comparison, and a gems-only "consider adding" list.

Signal-first and reuse-only: the heavy lifting lives in
``stocvest/api/services/portfolio_review.py`` (which reuses the Long-Term
composite engine + holder read). This handler is a thin JWT-scoped adapter.

Privacy: this response contains prices/cost/cash — it is only ever returned to
the authenticated owner, and the service never logs those values.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import not_found, ok, unauthorized
from stocvest.api.services.holdings_store import HoldingsStore, get_holdings_store
from stocvest.api.services.portfolio_review import build_portfolio_review
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _bullets(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [x for x in value if isinstance(x, dict)][:6]


def _build_ai_read_fn(user_id: str) -> Callable[[str, dict[str, Any]], Awaitable[str | None]] | None:
    """Per-holding AI Investment Read, reusing the gated deep-dive narrator.

    Returns ``None`` (no AI enrichment) unless the caller is entitled to AI
    explanations, so free accounts pay no LLM cost and the review stays deterministic.
    Narration is keyed/cached by the composite's ``pillar_snapshot_hash`` (reused until
    the underlying pillars change), and the copy guard keeps it non-advisory in product
    mode / personal-stance-only in personal mode — identical to the Position deep-dive.
    """
    try:
        profile = get_user_profile_store().get_profile(user_id)
    except Exception as exc:  # noqa: BLE001 — profile lookup is best-effort
        _LOG.warning("portfolio_review profile lookup failed: %s", exc)
        return None
    if profile is None or not profile.has_ai_explanations:
        return None

    from stocvest.signals.ai_explanations import AIExplanationService

    svc = AIExplanationService()

    async def _fn(symbol: str, body: dict[str, Any]) -> str | None:
        packet = body.get("position_thesis_packet")
        packet = packet if isinstance(packet, dict) else {}
        verdict = str(body.get("signal_summary") or body.get("verdict") or "neutral")
        result = await svc.explain_position_setup_read(
            symbol=symbol,
            verdict=verdict,
            bull_case=_bullets(packet.get("bull_case")),
            bear_case=_bullets(packet.get("bear_case")),
            open_questions=_bullets(packet.get("open_questions")),
            pillar_snapshot_hash=str(packet.get("pillar_snapshot_hash") or ""),
            user_profile=profile,
            fundamentals_covered=bool(packet.get("fundamentals_covered", True)),
        )
        return result.text

    return _fn


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_utc().replace(microsecond=0).isoformat()


def _is_fresh(cached_at: str | None, ttl_seconds: int) -> bool:
    """True when ``cached_at`` is within ``ttl_seconds`` of now (market-data staleness)."""
    if not cached_at:
        return False
    try:
        ts = datetime.fromisoformat(cached_at)
    except (ValueError, TypeError):
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (_now_utc() - ts).total_seconds() < max(0, ttl_seconds)


def _wants_refresh(event: LambdaEvent) -> bool:
    params = event.get("queryStringParameters") if isinstance(event, dict) else None
    if not isinstance(params, dict):
        return False
    val = str(params.get("refresh") or "").strip().lower()
    return val in ("1", "true", "yes")


def _with_cache_meta(
    review: dict[str, Any], *, cached: bool, cached_at: str | None, stale: bool
) -> dict[str, Any]:
    return {**review, "cached": cached, "cachedAt": cached_at, "stale": stale, "pending": False}


def _pending_response() -> dict[str, Any]:
    return ok({"pending": True, "cached": False, "cachedAt": None, "stale": False})


def trigger_async_review_refresh(user_id: str) -> bool:
    """Fire a background recompute via async self-invoke (InvocationType=Event).

    Returns ``True`` when the async invoke was dispatched (production Lambda), ``False``
    when there is no Lambda runtime to self-invoke (local/dev) or the invoke failed.
    Best-effort; never raises. The GET handler inlines only when this returns False
    *and* we are not inside AWS (so API Gateway never waits on the 20–28s composite).
    """
    fn_name = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    if not fn_name:
        return False
    try:
        import boto3

        client = boto3.client("lambda")
        client.invoke(
            FunctionName=fn_name,
            InvocationType="Event",
            Payload=json.dumps({"portfolio_review_refresh": user_id}).encode("utf-8"),
        )
        return True
    except Exception as exc:  # noqa: BLE001 — dispatch is best-effort; fall back to inline
        _LOG.warning("portfolio_review async refresh dispatch failed: %s", exc)
        return False


def run_portfolio_review_refresh(
    user_id: str, *, store: HoldingsStore | None = None
) -> tuple[dict[str, Any], str]:
    """Compute the full review for ``user_id`` and write it to the cache.

    Runs the heavy composite path (no 30s request budget — invoked async or offline),
    then persists the result on the user's Holdings item. Returns ``(review, cached_at)``.
    """
    store = store or get_holdings_store()
    holdings = store.list_holdings(user_id)
    settings = store.get_settings(user_id)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            user_id=user_id,
            user_email=None,
            ai_read_fn=_build_ai_read_fn(user_id),
        )
    )
    review_dict = review.to_api()
    cached_at = _now_iso()
    if holdings:
        try:
            store.put_cached_review(user_id, review_dict, cached_at)
        except Exception as exc:  # noqa: BLE001 — a cache-write failure must not fail the review
            _LOG.warning("portfolio_review cache write failed: %s", exc)
    return review_dict, cached_at


def portfolio_review_refresh_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    """Async entrypoint: recompute + cache one user's review (fired by the GET handler)."""
    _ = context
    user_id = str((event or {}).get("portfolio_review_refresh") or "").strip()
    if not user_id:
        return {"statusCode": 400, "refreshed": False}
    try:
        run_portfolio_review_refresh(user_id)
        return {"statusCode": 200, "refreshed": True}
    except Exception as exc:  # noqa: BLE001 — background job; log and report, never crash the runtime
        _LOG.warning("portfolio_review refresh failed: %s", exc)
        return {"statusCode": 500, "refreshed": False}


def portfolio_review_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    user_id = request_context.user_id
    if not user_id:
        return unauthorized("Authenticated user is required.")

    store = get_holdings_store()
    settings_cfg = get_settings()
    holdings = store.list_holdings(user_id)

    # Empty portfolio → the review is trivial and instant; never worth caching.
    if not holdings:
        review = asyncio.run(
            build_portfolio_review(
                holdings=holdings,
                settings=store.get_settings(user_id),
                user_id=user_id,
                user_email=request_context.email,
            )
        )
        return ok(_with_cache_meta(review.to_api(), cached=False, cached_at=None, stale=False))

    # Cache disabled → prior synchronous behavior (compute on every request).
    if not settings_cfg.portfolio_review_cache_enabled:
        review = asyncio.run(
            build_portfolio_review(
                holdings=holdings,
                settings=store.get_settings(user_id),
                user_id=user_id,
                user_email=request_context.email,
                ai_read_fn=_build_ai_read_fn(user_id),
            )
        )
        return ok(_with_cache_meta(review.to_api(), cached=False, cached_at=None, stale=False))

    force_refresh = _wants_refresh(event)
    cached_review, cached_at = store.get_cached_review(user_id)

    # Poll path (no ?refresh): serve whatever is cached (marking TTL staleness), or tell
    # the client to request a refresh. This path NEVER triggers a recompute, so polling
    # can't spawn duplicate background jobs — only an explicit ?refresh=1 does.
    if not force_refresh:
        if cached_review is not None:
            stale = not _is_fresh(cached_at, settings_cfg.portfolio_review_cache_ttl_seconds)
            return ok(_with_cache_meta(cached_review, cached=True, cached_at=cached_at, stale=stale))
        return _pending_response()

    # Refresh path (?refresh=1): kick a background recompute. In prod the async self-invoke
    # returns immediately (client polls the plain GET until cachedAt advances). Without a
    # Lambda runtime (local/dev) or if dispatch fails, compute inline so dev still works.
    dispatched = trigger_async_review_refresh(user_id)
    if not dispatched:
        # Local/dev has no Lambda runtime — compute inline so pytest and `next dev` still
        # produce a full review. Inside AWS, never compute on the request path: the
        # HTTP API integration dies at ~29s (11 holdings takes 20–28s) and the UI
        # shows "Could not run the review". Pending + poll is the production contract.
        if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
            review_dict, new_cached_at = run_portfolio_review_refresh(user_id, store=store)
            return ok(
                _with_cache_meta(review_dict, cached=True, cached_at=new_cached_at, stale=False)
            )
        _LOG.warning("portfolio_review async refresh unavailable; returning pending")
    if cached_review is not None:
        return ok(_with_cache_meta(cached_review, cached=True, cached_at=cached_at, stale=True))
    return _pending_response()


def portfolio_review_dispatch_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    rk = http_route_descriptor(event)
    if rk == "GET /v1/portfolio-review" or rk.startswith("GET /v1/portfolio-review?"):
        return portfolio_review_handler(event, context)
    _LOG.warning("portfolio_review_dispatch unknown route: %s", rk)
    return not_found(f"Unknown portfolio-review route: {rk or '(empty)'}")

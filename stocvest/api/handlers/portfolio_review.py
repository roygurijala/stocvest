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
from typing import Any, Awaitable, Callable

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import not_found, ok, unauthorized
from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_review import build_portfolio_review
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
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


def portfolio_review_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    store = get_holdings_store()
    holdings = store.list_holdings(request_context.user_id)
    settings = store.get_settings(request_context.user_id)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            user_id=request_context.user_id,
            user_email=request_context.email,
            ai_read_fn=_build_ai_read_fn(request_context.user_id),
        )
    )
    return ok(review.to_api())


def portfolio_review_dispatch_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    rk = http_route_descriptor(event)
    if rk == "GET /v1/portfolio-review" or rk.startswith("GET /v1/portfolio-review?"):
        return portfolio_review_handler(event, context)
    _LOG.warning("portfolio_review_dispatch unknown route: %s", rk)
    return not_found(f"Unknown portfolio-review route: {rk or '(empty)'}")

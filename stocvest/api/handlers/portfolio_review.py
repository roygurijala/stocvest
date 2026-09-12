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
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import not_found, ok, unauthorized
from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_review import build_portfolio_review
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


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

"""Phase 4a health endpoint handler."""

from __future__ import annotations

from stocvest import __version__
from stocvest.api.response import ok
from stocvest.api.types import LambdaContext, LambdaEvent


def handler(event: LambdaEvent, context: LambdaContext) -> dict:
    _ = context
    return ok(
        {
            "service": "stocvest-api",
            "status": "ok",
            "version": __version__,
            "path": str(event.get("path") or ""),
        }
    )


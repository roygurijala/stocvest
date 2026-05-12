"""Scheduled Lambda entry point for the D10 Phase 2b weight-proposal worker.

This handler is invoked by EventBridge on a weekly cadence (Monday 08:00
UTC, well before US market open). It is the thin Lambda-shape wrapper
around :func:`stocvest.api.services.weight_proposer.run_weight_proposer`
— all the orchestration lives in the service module so the handler is
trivially testable.

This Lambda runs under its own IAM role (``lambda_weight_proposer_execution``)
with strictly read-only access to Secrets Manager. The role is physically
incapable of mutating the production ``stocvest/signal-parameters`` secret
— rotating weights still requires a Phase-3 admin endpoint with elevated
permissions, plus an admin user explicitly approving the proposal from
the review UI. This is the three-IAM-principal architecture documented
in :doc:`docs/BACKLOG` under theme D10.
"""

from __future__ import annotations

import json
from typing import Any

from stocvest.api.response import ok
from stocvest.api.services.weight_proposer import run_weight_proposer
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.parameter_proposal_store import build_default_proposal_store
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def weight_proposer_scheduled_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    """EventBridge-scheduled entrypoint (no HTTP route).

    Always returns HTTP 200 — even on internal failure — so EventBridge
    does not retry storm. Failures are surfaced inside the response body
    (``error`` field on each mode's outcome) and via CloudWatch logs.
    """
    _ = context  # the worker is event-driven, not request-driven
    if isinstance(event, dict):
        src = event.get("source")
        _LOG.info(
            "weight_proposer triggered by EventBridge: %s", src or "(unknown)"
        )

    try:
        proposal_store = build_default_proposal_store()
    except Exception as exc:
        _LOG.exception("weight_proposer: failed to build proposal store: %s", exc)
        body = {"error": f"proposal store unavailable: {exc}", "modes": []}
        # Always return 200 to avoid EventBridge retry storms; the error
        # is in the body for whoever inspects the CloudWatch trace.
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, separators=(",", ":")),
        }

    try:
        summary = run_weight_proposer(proposal_store=proposal_store)
        payload = summary.to_dict()
        _LOG.info(
            "weight_proposer run summary: proposals_written=%s",
            payload.get("proposals_written"),
        )
        return ok(payload)
    except Exception as exc:
        _LOG.exception("weight_proposer top-level error: %s", exc)
        body = {"error": str(exc), "modes": []}
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, separators=(",", ":")),
        }

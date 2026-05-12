"""Lock-in tests for D10 Phase 3a — admin proposal HTTP handlers.

These tests pin the HTTP contract for the admin proposal-review surface
(``/v1/admin/proposals/*``). The surface is the *only* production code
path that mutates the live ``stocvest/signal-parameters`` Secrets
Manager secret under admin authority — so the auth gate, error
shapes, and audit-event emission contracts are all load-bearing.

What's locked in for every handler:

* **Auth gate**: without admin authorization (`analysis_authorized`
  returns False), the handler returns ``403`` with the canonical error
  body — independently of any other validation.
* **Path-param validation**: missing ``proposal_id`` → ``400``.
* **Happy path**: ``200`` + JSON body shape as documented.

Plus per-handler:

* **List**: status filter rejected when not in the closed set; limit
  clamped to ``_MAX_LIST_LIMIT``; ``503`` when proposal store unavailable.
* **Get**: ``404`` when proposal not found.
* **Promote**: ``409`` when proposal is not in pending state; ``500``
  when the secret-save fails (via patched service); audit event emitted.
* **Reject**: ``409`` on the ValueError from the data layer's atomic
  constraint; ``400`` on malformed JSON body.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_proposals import (
    admin_proposals_get_handler,
    admin_proposals_list_handler,
    admin_proposals_promote_handler,
    admin_proposals_reject_handler,
)
from stocvest.api.services.proposal_review import PromotionResult
from stocvest.data.parameter_proposal_store import (
    PROPOSAL_STATUS_PENDING,
    PROPOSAL_STATUS_PROMOTED,
    ParameterProposal,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _evt(
    *,
    method: str = "GET",
    path: str = "/v1/admin/proposals",
    path_params: dict[str, str] | None = None,
    query_params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    user_id: str = "admin-sub-123",
) -> dict[str, Any]:
    """Build a Lambda event dict with JWT claims so build_request_context resolves."""
    event: dict[str, Any] = {
        "path": path,
        "pathParameters": dict(path_params or {}),
        "queryStringParameters": dict(query_params or {}) if query_params else None,
        "requestContext": {
            "requestId": "req-test-1",
            "http": {"method": method, "path": path},
            "authorizer": {"claims": {"sub": user_id}},
        },
        "headers": {"x-stocvest-session-id": "sess-test-1"},
        "body": json.dumps(body) if body is not None else None,
    }
    return event


def _composite_block() -> dict[str, Any]:
    return {
        "technical_weight": 0.35,
        "news_weight": 0.15,
        "macro_weight": 0.20,
        "sector_weight": 0.15,
        "geopolitical_weight": 0.10,
        "internals_weight": 0.05,
        "bullish_threshold": 0.22,
        "bearish_threshold": -0.22,
    }


def _pending_proposal(proposal_id: str = "prop-aaaaaaaa") -> ParameterProposal:
    return ParameterProposal(
        proposal_id=proposal_id,
        status=PROPOSAL_STATUS_PENDING,
        created_at="2026-05-10T03:00:00+00:00",
        created_by_job="weight_proposer_scheduled",
        baseline_parameter_version="1.0.0",
        proposed_swing_composite=_composite_block(),
        proposed_day_composite=None,
        train_window_start="2026-03-15T00:00:00+00:00",
        train_window_end="2026-04-26T00:00:00+00:00",
        val_window_start="2026-04-26T00:00:00+00:00",
        val_window_end="2026-05-10T00:00:00+00:00",
        evidence={
            "swing": {
                "val_accuracy": 0.65,
                "val_accuracy_baseline": 0.60,
                "val_signal_count": 50,
            }
        },
    )


class _StubStore:
    """Minimal ProposalStore stand-in for handler tests.

    Provides the four methods the handlers touch — ``get``,
    ``list_by_status``, plus ``mark_rejected`` / ``mark_promoted`` /
    ``mark_superseded`` (only ``mark_rejected`` is invoked by the reject
    handler test path; the rest are exercised via the service tests).
    """

    def __init__(self, proposals: list[ParameterProposal] | None = None) -> None:
        self.proposals: dict[str, ParameterProposal] = {
            p.proposal_id: p for p in (proposals or [])
        }
        self.last_rejected: dict[str, Any] | None = None
        self.next_list_raises: Exception | None = None

    def get(self, proposal_id: str) -> ParameterProposal | None:
        return self.proposals.get(proposal_id)

    def list_by_status(self, status: str, *, limit: int = 20) -> list[ParameterProposal]:
        if self.next_list_raises is not None:
            raise self.next_list_raises
        return [p for p in self.proposals.values() if p.status == status][:limit]

    def mark_rejected(
        self,
        proposal_id: str,
        *,
        reviewed_at: str,
        reviewed_by: str,
        review_note: str | None = None,
    ) -> ParameterProposal:
        p = self.proposals.get(proposal_id)
        if p is None or p.status != PROPOSAL_STATUS_PENDING:
            raise ValueError(
                f"Proposal {proposal_id!r} is not in status 'pending'; "
                f"cannot transition to 'rejected'"
            )
        # Return a new proposal with the rejection metadata stamped.
        updated = ParameterProposal(
            **{
                **p.__dict__,
                "status": "rejected",
                "reviewed_at": reviewed_at,
                "reviewed_by": reviewed_by,
                "review_note": review_note,
            }
        )
        self.proposals[proposal_id] = updated
        self.last_rejected = {
            "reviewed_at": reviewed_at,
            "reviewed_by": reviewed_by,
            "review_note": review_note,
        }
        return updated


@pytest.fixture(autouse=True)
def _silence_audit() -> Any:
    """Make audit emission a no-op so handler tests don't hit DDB."""
    with patch("stocvest.api.handlers.admin_proposals.get_audit_store") as m:
        m.return_value.put_event.return_value = None
        yield m


# ---------------------------------------------------------------------------
# Auth gate — applies to all four handlers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "handler",
    [
        admin_proposals_list_handler,
        admin_proposals_get_handler,
        admin_proposals_promote_handler,
        admin_proposals_reject_handler,
    ],
)
def test_handlers_return_403_without_admin_auth(handler: Any) -> None:
    """Without admin authorization, every handler returns 403."""
    event = _evt(path_params={"proposal_id": "prop-aaaaaaaa"}, body={})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=False
    ):
        response = handler(event, None)
    assert response["statusCode"] == 403
    body = json.loads(response["body"])
    assert body["error"] == "forbidden"


# ---------------------------------------------------------------------------
# List handler
# ---------------------------------------------------------------------------


def test_list_handler_returns_summary_rows_for_pending_status() -> None:
    """Happy path — pending status returns 200 with the projection."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    event = _evt(query_params={"status": "pending"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"] == "pending"
    assert len(body["items"]) == 1
    assert body["items"][0]["proposal_id"] == proposal.proposal_id
    assert body["items"][0]["has_swing_proposal"] is True
    assert body["items"][0]["has_day_proposal"] is False


def test_list_handler_defaults_status_to_pending() -> None:
    """When no ?status=, the handler defaults to pending."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    event = _evt()
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=store)
    body = json.loads(response["body"])
    assert body["status"] == "pending"
    assert len(body["items"]) == 1


def test_list_handler_rejects_invalid_status() -> None:
    """A status outside the closed set returns 400."""
    event = _evt(query_params={"status": "garbage"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=_StubStore())
    assert response["statusCode"] == 400


def test_list_handler_rejects_non_integer_limit() -> None:
    """A non-integer limit returns 400."""
    event = _evt(query_params={"status": "pending", "limit": "many"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=_StubStore())
    assert response["statusCode"] == 400


def test_list_handler_clamps_limit_to_max() -> None:
    """An over-large limit is clamped (no 400) — defends against DOS-style scans."""
    store = _StubStore([_pending_proposal()])
    event = _evt(query_params={"status": "pending", "limit": "9999"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=store)
    body = json.loads(response["body"])
    assert response["statusCode"] == 200
    assert body["limit"] <= 100  # _MAX_LIST_LIMIT


def test_list_handler_returns_500_on_store_failure() -> None:
    """A boto3 explosion mid-list returns 500, not 502 — the failure is server-side."""
    store = _StubStore([_pending_proposal()])
    store.next_list_raises = RuntimeError("synthetic DDB outage")
    event = _evt()
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_list_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 500


# ---------------------------------------------------------------------------
# Get handler
# ---------------------------------------------------------------------------


def test_get_handler_returns_detail_dict() -> None:
    """Happy path — full detail returned."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    event = _evt(path_params={"proposal_id": proposal.proposal_id})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_get_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["proposal_id"] == proposal.proposal_id
    assert body["proposed_swing_composite"] is not None
    assert body["evidence"] is not None


def test_get_handler_returns_404_for_missing_proposal() -> None:
    """Missing proposal_id in the table → 404."""
    event = _evt(path_params={"proposal_id": "nonexistent"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_get_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 404


def test_get_handler_returns_400_when_path_param_missing() -> None:
    """No path param at all → 400 (not 404)."""
    event = _evt(path_params={})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_get_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 400


# ---------------------------------------------------------------------------
# Promote handler
# ---------------------------------------------------------------------------


def test_promote_handler_happy_path_returns_200() -> None:
    """Successful promote returns 200 with PromotionResult body shape."""
    event = _evt(method="POST", path_params={"proposal_id": "prop-aaaaaaaa"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_proposals.promote_proposal",
        return_value=PromotionResult(
            success=True,
            proposal_id="prop-aaaaaaaa",
            new_parameter_version="1.0.1",
            superseded_pending_ids=["prop-bbbbbbbb"],
        ),
    ):
        response = admin_proposals_promote_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["success"] is True
    assert body["new_parameter_version"] == "1.0.1"
    assert body["superseded_pending_ids"] == ["prop-bbbbbbbb"]


def test_promote_handler_returns_404_when_proposal_not_found() -> None:
    """error='not found' maps to 404."""
    event = _evt(method="POST", path_params={"proposal_id": "missing"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_proposals.promote_proposal",
        return_value=PromotionResult(
            success=False, proposal_id="missing", error="not found"
        ),
    ):
        response = admin_proposals_promote_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 404


def test_promote_handler_returns_409_when_proposal_not_pending() -> None:
    """error='not pending: promoted' maps to 409 (conflict, not 4xx-input-error)."""
    event = _evt(method="POST", path_params={"proposal_id": "prop-aaaaaaaa"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_proposals.promote_proposal",
        return_value=PromotionResult(
            success=False, proposal_id="prop-aaaaaaaa", error="not pending: promoted"
        ),
    ):
        response = admin_proposals_promote_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 409


def test_promote_handler_returns_500_on_save_failure() -> None:
    """error='parameter save failed' maps to 500 (server-side, not bad input)."""
    event = _evt(method="POST", path_params={"proposal_id": "prop-aaaaaaaa"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_proposals.promote_proposal",
        return_value=PromotionResult(
            success=False,
            proposal_id="prop-aaaaaaaa",
            error="parameter save failed",
        ),
    ):
        response = admin_proposals_promote_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 500


def test_promote_handler_returns_400_when_path_param_missing() -> None:
    event = _evt(method="POST", path_params={})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_promote_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 400


def test_promote_handler_emits_audit_event_on_success(_silence_audit: Any) -> None:
    """A successful promotion emits exactly one AuditEvent for chain-of-custody."""
    event = _evt(method="POST", path_params={"proposal_id": "prop-aaaaaaaa"})
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ), patch(
        "stocvest.api.handlers.admin_proposals.promote_proposal",
        return_value=PromotionResult(
            success=True, proposal_id="prop-aaaaaaaa", new_parameter_version="1.0.1"
        ),
    ):
        admin_proposals_promote_handler(event, None, proposal_store=_StubStore())
    audit_store = _silence_audit.return_value
    assert audit_store.put_event.call_count == 1


# ---------------------------------------------------------------------------
# Reject handler
# ---------------------------------------------------------------------------


def test_reject_handler_happy_path_returns_200() -> None:
    """Successful rejection returns 200 + the post-rejection detail dict."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    event = _evt(
        method="POST",
        path_params={"proposal_id": proposal.proposal_id},
        body={"review_note": "weights too aggressive for current regime"},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_reject_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"] == "rejected"
    assert body["review_note"] == "weights too aggressive for current regime"
    assert store.last_rejected is not None
    assert store.last_rejected["review_note"] == "weights too aggressive for current regime"


def test_reject_handler_returns_409_on_non_pending_proposal() -> None:
    """ValueError from mark_rejected (atomic constraint violation) maps to 409."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    # Pre-reject so the second rejection raises.
    store.mark_rejected(
        proposal.proposal_id, reviewed_at="t0", reviewed_by="prior", review_note=None
    )
    event = _evt(
        method="POST",
        path_params={"proposal_id": proposal.proposal_id},
        body={"review_note": "second attempt"},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_reject_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 409


def test_reject_handler_returns_400_on_invalid_json_body() -> None:
    """Malformed JSON body → 400."""
    event = _evt(
        method="POST",
        path_params={"proposal_id": "prop-aaaaaaaa"},
    )
    event["body"] = "{not-json}"
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_reject_handler(
            event, None, proposal_store=_StubStore()
        )
    assert response["statusCode"] == 400


def test_reject_handler_returns_400_when_review_note_not_string() -> None:
    """review_note must be a string when provided — non-string types rejected."""
    event = _evt(
        method="POST",
        path_params={"proposal_id": "prop-aaaaaaaa"},
        body={"review_note": 42},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_reject_handler(
            event, None, proposal_store=_StubStore([_pending_proposal()])
        )
    assert response["statusCode"] == 400


def test_reject_handler_allows_no_review_note() -> None:
    """An empty body (no review_note) is valid — rejection is recorded without a note."""
    proposal = _pending_proposal()
    store = _StubStore([proposal])
    event = _evt(
        method="POST",
        path_params={"proposal_id": proposal.proposal_id},
        body={},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=True
    ):
        response = admin_proposals_reject_handler(event, None, proposal_store=store)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["review_note"] is None


# ---------------------------------------------------------------------------
# Dispatch wiring — make sure the routes actually reach the handlers via
# `signals_http_dispatch`. Without these tests the API Gateway routes
# would silently fall through to "Unknown route" 404s in production.
# ---------------------------------------------------------------------------


def _dispatch_evt(*, method: str, path: str, path_params: dict[str, str] | None = None) -> dict[str, Any]:
    """Build a Lambda event in the shape that `http_route_descriptor` parses
    (uses ``routeKey`` from API Gateway HTTP API v2)."""
    route_key = f"{method} {path}"
    return {
        "routeKey": route_key,
        "path": path,
        "pathParameters": dict(path_params or {}),
        "requestContext": {
            "requestId": "req-test-dispatch",
            "http": {"method": method, "path": path},
            "authorizer": {"claims": {"sub": "admin-sub-123"}},
            "routeKey": route_key,
        },
        "headers": {},
    }


def test_dispatch_routes_list_admin_proposals() -> None:
    """`GET /v1/admin/proposals` reaches the list handler."""
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _dispatch_evt(method="GET", path="/v1/admin/proposals")
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=False
    ):
        response = signals_http_dispatch(event, None)
    # 403 from the admin auth gate means the dispatch reached our handler
    # (a non-wired route would return 404 "Unknown route" instead).
    assert response["statusCode"] == 403


def test_dispatch_routes_get_admin_proposal_by_id() -> None:
    """`GET /v1/admin/proposals/{proposal_id}` reaches the get handler."""
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _dispatch_evt(
        method="GET",
        path="/v1/admin/proposals/prop-aaaaaaaa",
        path_params={"proposal_id": "prop-aaaaaaaa"},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=False
    ):
        response = signals_http_dispatch(event, None)
    assert response["statusCode"] == 403


def test_dispatch_routes_promote_admin_proposal() -> None:
    """`POST /v1/admin/proposals/{proposal_id}/promote` reaches the promote handler."""
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _dispatch_evt(
        method="POST",
        path="/v1/admin/proposals/prop-aaaaaaaa/promote",
        path_params={"proposal_id": "prop-aaaaaaaa"},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=False
    ):
        response = signals_http_dispatch(event, None)
    assert response["statusCode"] == 403


def test_dispatch_routes_reject_admin_proposal() -> None:
    """`POST /v1/admin/proposals/{proposal_id}/reject` reaches the reject handler."""
    from stocvest.api.handlers.signals import signals_http_dispatch

    event = _dispatch_evt(
        method="POST",
        path="/v1/admin/proposals/prop-aaaaaaaa/reject",
        path_params={"proposal_id": "prop-aaaaaaaa"},
    )
    with patch(
        "stocvest.api.handlers.admin_proposals.analysis_authorized", return_value=False
    ):
        response = signals_http_dispatch(event, None)
    assert response["statusCode"] == 403

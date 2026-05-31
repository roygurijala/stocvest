"""
Tests for ``stocvest.api.handlers.signals.public_historical_validation_summary_handler``.

These lock in the D2 Phase 3c-1 public-mirror contract that the homepage performance
page (``frontend/components/performance-tracking-content.tsx``) depends on:

- Endpoint is **unauthenticated** — homepage visitors must be able to hit it without
  a JWT cookie.
- Response shape is the **trimmed projection** of the full summary: ``overall`` and
  ``by_mode`` only. The per-decision / per-regime / per-pattern / per-readiness /
  per-direction stratifications, and the ``parameter_versions`` provenance list, are
  ALL deliberately omitted to honor the assistant prompt's LOGGED-OUT golden rule
  ("Explain the FRAMEWORK, not the DECISION").
- ``symbol`` query parameter is **rejected with a calm 400**. Honoring it would let
  a logged-out visitor query per-ticker accuracy, which is exactly what the prompt
  rules forbid on the homepage surface.
- **Scope isolation is enforced by the store, not the handler.** The handler asks
  the service for ``user_id=None``, which the recorder translates to
  ``scope_key == "PUBLIC"``. User-scoped signals (any non-None ``user_id``) must
  never leak through. We test this by seeding both flavours and asserting only the
  public rows are counted.
- Defaults: ``horizon`` → ``"1d"`` (matches the marketing-facing swing track) and
  the window → trailing 90 days when ``from`` / ``to`` are omitted, so the homepage
  can hit the endpoint with no query string at all.
- ``BucketStats.accuracy`` of NaN serializes as JSON ``null`` (re-uses the Phase 3a
  ``_bucket_stats_to_dict`` helper); locks in the same em-dash-never-0% UI contract
  that the dashboard tab relies on.
- The standing ``HISTORICAL_VALIDATION_DISCLAIMER`` from
  ``stocvest.api.legal_copy`` rides on every response verbatim — single-sourced with
  the assistant prompt and the authenticated /summary endpoint.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.handlers.signals import (
    PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS,
    public_historical_validation_summary_handler,
)
from stocvest.api.legal_copy import HISTORICAL_VALIDATION_DISCLAIMER
from stocvest.api.services.signal_recorder import (
    InMemorySignalRecorder,
    reset_signal_recorder_for_tests,
)
from stocvest.data.models import SignalRecord


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _signal(
    *,
    signal_id: str,
    user_id: str | None = None,  # default to public scope
    symbol: str = "AAPL",
    direction: str = "bullish",
    signal_strength: int = 75,
    pattern: str = "swing_composite",
    mode: str = "swing",
    outcome_1h: str | None = None,
    outcome_1d: str | None = "correct",
    parameter_version: str | None = "v1",
    generated_at: datetime | None = None,
    decision_state_entry: str | None = "actionable",
    regime_label_at_entry: str | None = "risk_on",
    ledger_qualified: bool = True,
    capture_kind: str | None = "qualified",
) -> SignalRecord:
    return SignalRecord(
        signal_id=signal_id,
        symbol=symbol,
        direction=direction,
        signal_strength=signal_strength,
        pattern=pattern,
        layer_scores={},
        price_at_signal=100.0,
        generated_at=generated_at or datetime.now(timezone.utc) - timedelta(hours=2),
        outcome_1h=outcome_1h,
        outcome_1d=outcome_1d,
        mode=mode,
        decision_state_entry=decision_state_entry,
        regime_label_at_entry=regime_label_at_entry,
        parameter_version=parameter_version,
        user_id=user_id,
        ledger_qualified=ledger_qualified,
        capture_kind=capture_kind,  # type: ignore[arg-type]
    )


def _event(*, qs: dict[str, str] | None = None) -> dict:
    """Build a Lambda-style event for the public endpoint — no authorizer claims."""

    return {
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/v1/signals/historical-validation/public-summary",
            },
            # No "authorizer" key at all — this is the unauthenticated route.
        },
        "queryStringParameters": qs,
    }


# ─────────────────────────────────────────────────────────────────────────────
# No auth required
# ─────────────────────────────────────────────────────────────────────────────


def test_no_auth_required_returns_200_with_empty_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint must return a 200 even when nothing is in the store and there is
    no authenticated user — homepage visitors land here pre-login."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = public_historical_validation_summary_handler(_event(), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["disclaimer"] == HISTORICAL_VALIDATION_DISCLAIMER
    assert body["summary"]["overall"]["total_signals"] == 0
    # Empty store → NaN accuracy → JSON null. Locks in the em-dash UI contract.
    assert body["summary"]["overall"]["accuracy"] is None
    assert "NaN" not in resp["body"]


# ─────────────────────────────────────────────────────────────────────────────
# Trimmed-projection response shape
# ─────────────────────────────────────────────────────────────────────────────


def test_response_omits_logged_in_only_stratifications(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The trimmed-projection contract: the public surface MUST NOT expose
    by_decision / by_regime / by_pattern / by_readiness / by_direction /
    parameter_versions, no matter how the underlying summary is shaped."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="p1", outcome_1d="correct", mode="swing"))
    mem.record_signal(_signal(signal_id="p2", outcome_1d="correct", mode="swing"))
    mem.record_signal(_signal(signal_id="p3", outcome_1d="incorrect", mode="day"))

    resp = public_historical_validation_summary_handler(_event(), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    summary = body["summary"]

    # What MUST be present (product KPI cohort metadata + trimmed stratification).
    assert set(summary.keys()) == {
        "horizon",
        "overall",
        "by_mode",
        "rows_examined",
        "cohort_definition",
        "meets_minimum_sample",
        "minimum_resolved_required",
        "resolved_non_neutral",
        "cohort_rows",
        "pending_outcome",
        "signals_per_week",
        "coverage_low",
        "accuracy_ci_low_percent",
        "accuracy_ci_high_percent",
        "trading_days_in_window",
        "trading_day_coverage_pct",
    }
    assert summary["overall"]["total_signals"] == 3
    # Two swing correct + one day incorrect → swing 2/2, day 0/1.
    assert summary["by_mode"]["swing"]["correct"] == 2
    assert summary["by_mode"]["swing"]["incorrect"] == 0
    assert summary["by_mode"]["day"]["correct"] == 0
    assert summary["by_mode"]["day"]["incorrect"] == 1

    # What MUST NOT be present — these would violate the homepage-safe contract.
    for forbidden_key in (
        "by_decision",
        "by_regime",
        "by_pattern",
        "by_readiness",
        "by_direction",
        "parameter_versions",
    ):
        assert forbidden_key not in summary, (
            f"{forbidden_key} leaked into the public summary — homepage-safe contract broken"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Symbol gate
# ─────────────────────────────────────────────────────────────────────────────


def test_rejects_symbol_query_parameter_with_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The prompt rules forbid per-symbol queries from the logged-out surface. The
    public handler must reject ``symbol`` outright rather than silently ignoring it,
    so any caller wiring it up sees the rejection."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = public_historical_validation_summary_handler(_event(qs={"symbol": "AAPL"}), {})

    assert resp["statusCode"] == 400
    body = json.loads(resp["body"])
    assert body["error"] == "bad_request"
    assert "symbol" in body["message"].lower()


# ─────────────────────────────────────────────────────────────────────────────
# Scope isolation
# ─────────────────────────────────────────────────────────────────────────────


def test_user_scoped_rows_never_appear_in_public_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Any signal with a non-None ``user_id`` belongs to a user scope and must NEVER
    surface in the public mirror. This is the cross-scope leak we care about most —
    the recorder enforces it via ``scope_key`` filtering, this test locks that in."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    # One public-scope row (the only one that should be counted).
    mem.record_signal(_signal(signal_id="pub1", user_id=None, outcome_1d="correct"))
    # Three user-scoped rows belonging to two different users.
    mem.record_signal(_signal(signal_id="u1a", user_id="u-alpha", outcome_1d="correct"))
    mem.record_signal(_signal(signal_id="u1b", user_id="u-alpha", outcome_1d="correct"))
    mem.record_signal(_signal(signal_id="u2a", user_id="u-beta", outcome_1d="incorrect"))

    resp = public_historical_validation_summary_handler(_event(), {})

    assert resp["statusCode"] == 200
    summary = json.loads(resp["body"])["summary"]
    assert summary["overall"]["total_signals"] == 1, (
        "user-scoped rows leaked into the public summary"
    )
    assert summary["overall"]["correct"] == 1
    assert summary["overall"]["incorrect"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Defaults — horizon and window
# ─────────────────────────────────────────────────────────────────────────────


def test_default_horizon_is_1d_when_omitted(monkeypatch: pytest.MonkeyPatch) -> None:
    """No ``horizon`` query parameter → default ``"1d"`` (matches the marketing-facing
    swing track). The 1d outcome column is what's resolved against."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    # outcome_1d set, outcome_1h NOT set — if the default horizon were 1h the row
    # would resolve as "neutral" and accuracy would land at NaN; with the 1d default
    # it resolves to 1/1 = 100%.
    mem.record_signal(
        _signal(signal_id="d1", outcome_1h=None, outcome_1d="correct")
    )

    resp = public_historical_validation_summary_handler(_event(), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["horizon"] == "1d"
    assert body["summary"]["horizon"] == "1d"
    assert body["summary"]["overall"]["correct"] == 1
    assert body["summary"]["overall"]["accuracy"] == pytest.approx(1.0)


def test_default_window_is_trailing_n_days_when_from_to_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ``from`` / ``to`` query parameters → default trailing
    ``PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS``-day window ending now. Rows older
    than that window must be excluded."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    now = datetime.now(timezone.utc)
    # Recent row — must appear.
    mem.record_signal(
        _signal(
            signal_id="recent",
            outcome_1d="correct",
            generated_at=now - timedelta(days=10),
        )
    )
    # Row older than the default window — must be excluded.
    mem.record_signal(
        _signal(
            signal_id="ancient",
            outcome_1d="correct",
            generated_at=now - timedelta(days=PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS + 30),
        )
    )

    resp = public_historical_validation_summary_handler(_event(), {})

    assert resp["statusCode"] == 200
    summary = json.loads(resp["body"])["summary"]
    assert summary["overall"]["total_signals"] == 1, (
        "default trailing window did not exclude rows older than the cap"
    )
    assert summary["overall"]["correct"] == 1


def test_partial_window_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    """Either supply both bounds or neither — partial windows (only ``from`` OR only
    ``to``) are ambiguous and trigger a calm 400 rather than silently substituting
    a default."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = public_historical_validation_summary_handler(
        _event(qs={"from": "2026-04-01T00:00:00Z"}), {}
    )

    assert resp["statusCode"] == 400
    body = json.loads(resp["body"])
    assert body["error"] == "bad_request"


# ─────────────────────────────────────────────────────────────────────────────
# Filters
# ─────────────────────────────────────────────────────────────────────────────


def test_mode_filter_passes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """``mode=swing`` filters at the store; day rows must not contribute."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="s1", mode="swing", outcome_1d="correct"))
    mem.record_signal(_signal(signal_id="s2", mode="swing", outcome_1d="correct"))
    mem.record_signal(_signal(signal_id="d1", mode="day", outcome_1d="incorrect"))

    resp = public_historical_validation_summary_handler(_event(qs={"mode": "swing"}), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["mode"] == "swing"
    summary = body["summary"]
    assert summary["overall"]["total_signals"] == 2
    assert summary["overall"]["correct"] == 2
    assert summary["overall"]["incorrect"] == 0
    # by_mode pre-seeds both declared modes (Phase 1 aggregator vocabulary contract),
    # so "day" is still present in the response shape — but with zero contribution
    # because the filter excluded those rows at the store layer.
    assert "swing" in summary["by_mode"]
    assert summary["by_mode"]["swing"]["correct"] == 2
    assert "day" in summary["by_mode"]
    assert summary["by_mode"]["day"]["total_signals"] == 0
    assert summary["by_mode"]["day"]["correct"] == 0


def test_rejects_invalid_horizon_with_400(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-empty but invalid horizon must surface a calm 400 rather than silently
    falling back to the default — same behavior as the authenticated endpoint."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = public_historical_validation_summary_handler(_event(qs={"horizon": "1w"}), {})

    assert resp["statusCode"] == 400
    body = json.loads(resp["body"])
    assert body["error"] == "bad_request"
    assert "horizon" in body["message"]


def test_explicit_window_and_horizon_round_trip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When both ``from`` and ``to`` AND ``horizon`` are supplied, they are echoed
    back in the response and used for the underlying query."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    now = datetime.now(timezone.utc)
    mem.record_signal(_signal(signal_id="p1", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="p2", outcome_1h="incorrect"))

    qs = {
        "horizon": "1h",
        "from": (now - timedelta(days=7)).isoformat().replace("+00:00", "Z"),
        "to": (now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
    }
    resp = public_historical_validation_summary_handler(_event(qs=qs), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["horizon"] == "1h"
    assert body["summary"]["horizon"] == "1h"
    assert body["summary"]["overall"]["correct"] == 1
    assert body["summary"]["overall"]["incorrect"] == 1
    assert body["summary"]["overall"]["accuracy"] == pytest.approx(0.5)

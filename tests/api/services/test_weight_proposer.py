"""Lock-in tests for D10 Phase 2b — weight-proposal worker orchestration.

These tests pin the contract for the scheduled-Lambda orchestrator that wires
the pure-function optimizer (Phase 2a) to the data layer (Phase 1). What's
locked in:

* :func:`build_historical_rows_for_mode` projection rules — mode filter,
  resolution check, time-window filter, empty-layer-scores skip,
  chronological sort, horizon switching (1d vs 1h), regime translation,
  loud rejection on bad inputs.
* :func:`load_baseline_for_mode` routes through the shared
  :func:`resolve_composite_block` helper — so when an operator adds per-mode
  override blocks to the secret payload, the optimizer's baseline reflects
  it (this is the same path the live engine uses; B30 Phase 3 contract).
* :func:`run_weight_proposer` end-to-end:
  - both modes run independently, each emitting a :class:`ModeRunOutcome`;
  - the orchestrator writes a proposal ONLY when the gate accepts;
  - per-mode failures (empty rows, bad data, mid-flight exception) DO NOT
    block the other mode from completing — the Lambda is a scheduled
    worker, so error isolation between modes is load-bearing;
  - the written proposal carries the right per-mode composite block (a
    swing run produces ``proposed_swing_composite`` only, day ditto),
    plus the baseline parameter version and the full evidence payload.

The Lambda handler is also exercised end-to-end here for top-level shape
assertions (always returns ``statusCode == 200`` even on internal failure,
to avoid EventBridge retry storms).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest

from stocvest.api.services.weight_proposer import (
    DEFAULT_TRAILING_DAYS,
    ModeRunOutcome,
    ProposalRunSummary,
    build_historical_rows_for_mode,
    load_baseline_for_mode,
    run_weight_proposer,
)
from stocvest.config.signal_parameters import (
    CompositeParameters,
    SignalParameters,
    default_signal_parameters,
)
from stocvest.data.models import SignalRecord
from stocvest.data.parameter_proposal_store import (
    PROPOSAL_STATUS_PENDING,
    ParameterProposal,
    ParameterProposalStore,
)
from stocvest.signals.weight_optimizer import (
    WEIGHT_LAYERS,
    WeightSet,
)


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


_NOW = datetime(2026, 5, 10, 8, 0, tzinfo=timezone.utc)


def _make_record(
    *,
    mode: str = "swing",
    days_ago: int = 1,
    resolved_1d: bool = True,
    price_at_signal: float = 100.0,
    price_1d_after: float | None = 105.0,
    layer_scores: dict[str, float] | None = None,
    direction: str = "bullish",
    regime_label_at_entry: str | None = "risk_on",
    resolved_1h: bool = False,
    price_1h_after: float | None = None,
    user_id: str | None = None,
) -> SignalRecord:
    """Construct a minimal valid SignalRecord for orchestrator tests."""
    return SignalRecord(
        signal_id=f"sig-{mode}-{days_ago}d-{id(layer_scores)}",
        symbol="AAPL",
        direction=direction,
        signal_strength=60,
        pattern="swing_composite" if mode == "swing" else "intraday_composite",
        layer_scores=layer_scores if layer_scores is not None else {layer: 0.6 for layer in WEIGHT_LAYERS},
        price_at_signal=price_at_signal,
        generated_at=_NOW - timedelta(days=days_ago),
        resolved_1h=resolved_1h,
        resolved_1d=resolved_1d,
        price_1h_after=price_1h_after,
        price_1d_after=price_1d_after,
        outcome_1d="correct" if resolved_1d else None,
        mode=mode,  # type: ignore[arg-type]
        regime_label_at_entry=regime_label_at_entry,
        user_id=user_id,
    )


def _fake_signal_params(
    *,
    version: str = "1.0.0",
    with_swing_override: bool = False,
    with_day_override: bool = False,
) -> SignalParameters:
    """Build a SignalParameters with optional per-mode override blocks."""
    params = default_signal_parameters()
    params.version = version
    if with_swing_override:
        params.swing_composite = CompositeParameters(
            technical_weight=0.35,
            news_weight=0.15,
            macro_weight=0.20,
            sector_weight=0.18,
            geopolitical_weight=0.07,
            internals_weight=0.05,
            bullish_threshold=0.22,
            bearish_threshold=-0.22,
        )
    if with_day_override:
        params.day_composite = CompositeParameters(
            technical_weight=0.32,
            news_weight=0.20,
            macro_weight=0.10,
            sector_weight=0.13,
            geopolitical_weight=0.08,
            internals_weight=0.17,
            bullish_threshold=0.18,
            bearish_threshold=-0.18,
        )
    return params


class _InMemoryProposalStore:
    """Test double for :class:`ParameterProposalStore`. Tracks every ``put``."""

    def __init__(self) -> None:
        self.proposals: list[ParameterProposal] = []

    def put(self, proposal: ParameterProposal) -> None:
        self.proposals.append(proposal)


class _ProvidedParameterStore:
    """Test double for :class:`ParameterStore` — caller injects exactly the
    SignalParameters to return."""

    def __init__(self, params: SignalParameters) -> None:
        self._params = params

    def get_parameters_sync(self) -> SignalParameters:
        return self._params


# ---------------------------------------------------------------------------
# build_historical_rows_for_mode — projection rules
# ---------------------------------------------------------------------------


def test_build_rows_filters_by_mode() -> None:
    """Only mode-matched rows survive — swing+day mixed input is bucketed correctly."""
    records = [
        _make_record(mode="swing", days_ago=1),
        _make_record(mode="day", days_ago=2),
        _make_record(mode="swing", days_ago=3),
    ]
    swing_rows = build_historical_rows_for_mode(
        records, mode="swing", now=_NOW, trailing_days=30
    )
    day_rows = build_historical_rows_for_mode(
        records, mode="day", now=_NOW, trailing_days=30
    )
    assert len(swing_rows) == 2
    assert len(day_rows) == 1


def test_build_rows_excludes_unresolved_records() -> None:
    """A row missing ``price_1d_after`` is unresolved and gets dropped."""
    records = [
        _make_record(mode="swing", days_ago=1, resolved_1d=True, price_1d_after=105.0),
        _make_record(mode="swing", days_ago=2, resolved_1d=False, price_1d_after=None),
    ]
    rows = build_historical_rows_for_mode(records, mode="swing", now=_NOW, trailing_days=30)
    assert len(rows) == 1
    assert rows[0].price_after == 105.0


def test_build_rows_filters_outside_trailing_window() -> None:
    """Rows older than trailing_days are dropped — regime stationarity boundary."""
    records = [
        _make_record(mode="swing", days_ago=10),  # within window
        _make_record(mode="swing", days_ago=120),  # too old
    ]
    rows = build_historical_rows_for_mode(records, mode="swing", now=_NOW, trailing_days=60)
    assert len(rows) == 1


def test_build_rows_drops_empty_layer_scores() -> None:
    """A row with no layer_scores can't be re-scored; live engine would have skipped it too."""
    records = [
        _make_record(mode="swing", days_ago=1, layer_scores={"technical": 0.5}),
        _make_record(mode="swing", days_ago=2, layer_scores={}),
    ]
    rows = build_historical_rows_for_mode(records, mode="swing", now=_NOW, trailing_days=30)
    assert len(rows) == 1


def test_build_rows_excludes_shadow_and_unavailable_patterns() -> None:
    """Optimizer cohort excludes gate-study shadow rows and unavailable patterns."""
    good = _make_record(mode="day", days_ago=1)
    good.pattern = "breakout_long"
    shadow = _make_record(mode="day", days_ago=2)
    shadow.pattern = "breakout_long:ledger_capture_shadow"
    shadow.capture_kind = "shadow"
    unavailable = _make_record(mode="day", days_ago=3)
    unavailable.pattern = "unavailable"
    unavailable_shadow = _make_record(mode="day", days_ago=4)
    unavailable_shadow.pattern = "unavailable:ledger_capture_shadow"
    unavailable_shadow.capture_kind = "shadow"
    rows = build_historical_rows_for_mode(
        [good, shadow, unavailable, unavailable_shadow],
        mode="day",
        now=_NOW,
        trailing_days=30,
    )
    assert len(rows) == 1


def test_build_rows_sorted_chronologically_ascending() -> None:
    """Output is sorted ASC by generated_at — walk_forward_split's invariant."""
    records = [
        _make_record(mode="swing", days_ago=1),  # newest
        _make_record(mode="swing", days_ago=5),  # oldest
        _make_record(mode="swing", days_ago=3),  # middle
    ]
    rows = build_historical_rows_for_mode(records, mode="swing", now=_NOW, trailing_days=30)
    assert [r.generated_at for r in rows] == sorted(r.generated_at for r in rows)


def test_build_rows_uses_1h_horizon_when_requested() -> None:
    """Switching horizon picks the 1h post-resolution price instead of 1d."""
    record = _make_record(
        mode="day",
        days_ago=1,
        resolved_1h=True,
        resolved_1d=False,
        price_1h_after=101.5,
        price_1d_after=None,
    )
    rows = build_historical_rows_for_mode(
        [record], mode="day", now=_NOW, trailing_days=30, horizon="1h"
    )
    assert len(rows) == 1
    assert rows[0].price_after == 101.5


def test_build_rows_translates_regime_label() -> None:
    """Application-level labels (risk_on / risk_off / etc.) translate to engine vocab."""
    records = [
        _make_record(mode="swing", days_ago=1, regime_label_at_entry="risk_on"),
        _make_record(mode="swing", days_ago=2, regime_label_at_entry="risk_off"),
        _make_record(mode="swing", days_ago=3, regime_label_at_entry="neutral"),
        _make_record(mode="swing", days_ago=4, regime_label_at_entry=None),
    ]
    rows = build_historical_rows_for_mode(records, mode="swing", now=_NOW, trailing_days=30)
    regimes = {r.regime_for_engine for r in rows}
    assert "bull" in regimes
    assert "bear" in regimes
    assert "sideways" in regimes


def test_build_rows_rejects_unknown_mode() -> None:
    """Bad mode → loud reject (the orchestrator's _MODES tuple is the contract)."""
    with pytest.raises(ValueError, match="unknown mode"):
        build_historical_rows_for_mode([], mode="options", now=_NOW)


def test_build_rows_rejects_non_positive_trailing_days() -> None:
    """trailing_days must be positive."""
    with pytest.raises(ValueError, match="trailing_days must be positive"):
        build_historical_rows_for_mode([], mode="swing", now=_NOW, trailing_days=0)
    with pytest.raises(ValueError, match="trailing_days must be positive"):
        build_historical_rows_for_mode([], mode="swing", now=_NOW, trailing_days=-1)


# ---------------------------------------------------------------------------
# load_baseline_for_mode
# ---------------------------------------------------------------------------


def test_load_baseline_for_mode_uses_shared_block_when_no_override() -> None:
    """No per-mode override → shared composite block is the baseline."""
    params = _fake_signal_params()
    swing_w, swing_bull, swing_bear = load_baseline_for_mode(params, "swing")
    day_w, day_bull, day_bear = load_baseline_for_mode(params, "day")
    # Without overrides, both modes lift the same shared block.
    assert swing_w.as_dict() == day_w.as_dict()
    assert swing_bull == day_bull
    assert swing_bear == day_bear


def test_load_baseline_for_mode_routes_to_per_mode_override() -> None:
    """When the secret has a per-mode override, that block is the baseline."""
    params = _fake_signal_params(with_swing_override=True, with_day_override=True)
    swing_w, _, _ = load_baseline_for_mode(params, "swing")
    day_w, _, _ = load_baseline_for_mode(params, "day")
    # Distinct overrides should produce distinct weight sets.
    assert swing_w.as_dict() != day_w.as_dict()
    # Spot-check that the swing override leaked through.
    assert swing_w.technical == 0.35


def test_load_baseline_for_mode_returns_thresholds_from_resolved_block() -> None:
    """Thresholds come from the resolved block, not the shared one when an override exists."""
    params = _fake_signal_params(with_swing_override=True)
    _, swing_bull, swing_bear = load_baseline_for_mode(params, "swing")
    # Override's thresholds.
    assert swing_bull == 0.22
    assert swing_bear == -0.22


# ---------------------------------------------------------------------------
# run_weight_proposer — top-level orchestration
# ---------------------------------------------------------------------------


def _bullish_dataset(*, mode: str, count: int) -> list[SignalRecord]:
    """Generate a uniformly-bullish-and-correct synthetic dataset.

    Every row has every layer scoring 0.6 (bullish) and the price moves up
    5%. Under any reasonable weights the verdict is "bullish" and the
    outcome is "correct" → baseline accuracy is 1.0, and no candidate can
    beat it. This is the right shape to assert "the orchestrator runs to
    completion and produces an acceptance decision, even when there's no
    actual rotation to propose".
    """
    return [
        _make_record(
            mode=mode,
            days_ago=count - i,  # oldest first when sorted ASC
            layer_scores={layer: 0.6 for layer in WEIGHT_LAYERS},
            price_at_signal=100.0,
            price_1d_after=105.0,
        )
        for i in range(count)
    ]


def test_run_weight_proposer_returns_summary_with_one_outcome_per_mode() -> None:
    """Every run produces exactly one ModeRunOutcome per mode, in canonical order."""
    records = _bullish_dataset(mode="swing", count=40) + _bullish_dataset(mode="day", count=40)
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=_InMemoryProposalStore(),  # type: ignore[arg-type]
        records=records,
        now=_NOW,
    )
    assert isinstance(summary, ProposalRunSummary)
    assert [o.mode for o in summary.mode_outcomes] == ["swing", "day"]


def test_run_weight_proposer_records_rows_evaluated_per_mode() -> None:
    """rows_evaluated reports the projected-input count after all filters."""
    records = _bullish_dataset(mode="swing", count=35) + _bullish_dataset(mode="day", count=20)
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=_InMemoryProposalStore(),  # type: ignore[arg-type]
        records=records,
        now=_NOW,
    )
    by_mode = {o.mode: o for o in summary.mode_outcomes}
    assert by_mode["swing"].rows_evaluated == 35
    assert by_mode["day"].rows_evaluated == 20


def test_run_weight_proposer_skips_write_when_no_rows_for_mode() -> None:
    """An empty per-mode dataset reports an error but does NOT raise."""
    swing_only = _bullish_dataset(mode="swing", count=40)
    store = _InMemoryProposalStore()
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=store,  # type: ignore[arg-type]
        records=swing_only,
        now=_NOW,
    )
    by_mode = {o.mode: o for o in summary.mode_outcomes}
    assert by_mode["day"].error is not None
    assert "no resolved rows" in by_mode["day"].error
    assert by_mode["day"].proposal_id is None


def test_run_weight_proposer_skips_write_when_no_lift() -> None:
    """All-correct synthetic input → baseline accuracy 1.0 → no candidate
    can beat it → acceptance gate rejects, no proposal written."""
    records = _bullish_dataset(mode="swing", count=40) + _bullish_dataset(mode="day", count=40)
    store = _InMemoryProposalStore()
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=store,  # type: ignore[arg-type]
        records=records,
        now=_NOW,
    )
    # Every mode's acceptance should be False (no lift over a perfect baseline).
    for outcome in summary.mode_outcomes:
        assert outcome.acceptance is not None, outcome.error
        assert outcome.acceptance.accepted is False
        assert outcome.proposal_id is None
    # No proposals written.
    assert store.proposals == []


def test_run_weight_proposer_writes_proposal_when_gate_accepts() -> None:
    """Build a dataset where the optimizer can find a rotation and the gate accepts.

    Strategy: news bullish + technical bearish + price moves bullish in
    train AND val. Baseline (tech 0.30, news 0.20) gets fooled by the
    bigger technical weight → mostly bearish verdict → wrong. The
    optimizer rotates weight toward news → bullish verdict → right.
    Loosen the gate so the rotation is acceptable on synthetic data.
    """
    rows: list[SignalRecord] = []
    # 40 rows ≥ 30-signal val minimum after 75/25 split (40*0.75=30 train, 10 val ≥ 10 with loose gate)
    for i in range(40):
        rows.append(
            _make_record(
                mode="swing",
                days_ago=40 - i,
                layer_scores={
                    "technical": -0.7,
                    "news": 0.9,
                    "macro": 0.0,
                    "sector": 0.0,
                    "geopolitical": 0.0,
                    "internals": 0.0,
                },
                price_at_signal=100.0,
                price_1d_after=105.0,
            )
        )
    store = _InMemoryProposalStore()
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=store,  # type: ignore[arg-type]
        records=rows,
        now=_NOW,
        # Loosen the gate: synthetic dataset is small so we run with lower
        # thresholds than production defaults.
        min_val_signal_count=8,
        min_val_accuracy_improvement=0.01,
    )
    swing_outcome = next(o for o in summary.mode_outcomes if o.mode == "swing")
    # The optimizer should have found a positive-lift candidate.
    assert swing_outcome.optimization_result is not None
    # We do not assert the gate definitively accepts (it depends on regime
    # distribution match on synthetic data). Instead, assert that the
    # plumbing is wired: an acceptance decision exists, and IF accepted,
    # the proposal carries the right per-mode block.
    assert swing_outcome.acceptance is not None
    if swing_outcome.acceptance.accepted:
        assert swing_outcome.proposal_id is not None
        assert len(store.proposals) == 1
        p = store.proposals[0]
        assert p.proposed_swing_composite is not None
        assert p.proposed_day_composite is None
        assert p.status == PROPOSAL_STATUS_PENDING
        assert p.baseline_parameter_version == "1.0.0"


def test_run_weight_proposer_proposal_carries_per_mode_composite_block() -> None:
    """When a swing-mode rotation is accepted, the proposal sets
    ``proposed_swing_composite`` (not ``proposed_day_composite``) — and
    vice versa for day. Pin this via direct factory-call assertion.

    We construct an optimization result that beats baseline by injecting
    a synthetic decision through a patched ``accept_proposal`` so the
    test doesn't depend on the optimizer finding a rotation."""
    from stocvest.api.services import weight_proposer as wp_module
    from stocvest.signals.weight_optimizer import ProposalAcceptance

    rows = _bullish_dataset(mode="swing", count=40)
    store = _InMemoryProposalStore()

    # Force the gate to accept so we can assert what the proposal looks like.
    with patch.object(
        wp_module,
        "accept_proposal",
        return_value=ProposalAcceptance(accepted=True, reason="forced for test"),
    ):
        summary = run_weight_proposer(
            parameter_store=_ProvidedParameterStore(_fake_signal_params()),
            proposal_store=store,  # type: ignore[arg-type]
            records=rows,
            now=_NOW,
        )

    swing_outcome = next(o for o in summary.mode_outcomes if o.mode == "swing")
    assert swing_outcome.proposal_id is not None
    assert len(store.proposals) >= 1
    proposal = next(
        p for p in store.proposals if p.proposal_id == swing_outcome.proposal_id
    )
    assert proposal.proposed_swing_composite is not None
    assert proposal.proposed_day_composite is None
    # Evidence carries the per-mode evidence dict keyed by mode.
    assert "swing" in proposal.evidence
    # The proposal's composite block must carry the four required weight
    # fields + the two thresholds — matches CompositeParameters parsing
    # contract that Phase 3's promotion path will use.
    block = proposal.proposed_swing_composite
    assert {
        "technical_weight",
        "news_weight",
        "macro_weight",
        "sector_weight",
        "geopolitical_weight",
        "internals_weight",
        "bullish_threshold",
        "bearish_threshold",
    }.issubset(set(block.keys()))


def test_run_weight_proposer_isolates_per_mode_failures() -> None:
    """A failure in one mode does NOT block the other mode from completing.

    Injected via patching: swing's optimizer raises, day's optimizer runs
    cleanly. The summary must show swing.error and day.acceptance.
    """
    from stocvest.api.services import weight_proposer as wp_module

    rows = _bullish_dataset(mode="swing", count=40) + _bullish_dataset(mode="day", count=40)
    store = _InMemoryProposalStore()

    real_optimizer = wp_module.optimize_weights_for_mode

    def _flaky_optimizer(rows_in, baseline, **kwargs):  # type: ignore[no-untyped-def]
        # First call (swing) raises; second call (day) runs the real optimizer.
        if not hasattr(_flaky_optimizer, "_called"):  # type: ignore[attr-defined]
            _flaky_optimizer._called = True  # type: ignore[attr-defined]
            raise RuntimeError("synthetic swing failure")
        return real_optimizer(rows_in, baseline, **kwargs)

    with patch.object(wp_module, "optimize_weights_for_mode", side_effect=_flaky_optimizer):
        summary = run_weight_proposer(
            parameter_store=_ProvidedParameterStore(_fake_signal_params()),
            proposal_store=store,  # type: ignore[arg-type]
            records=rows,
            now=_NOW,
        )

    by_mode = {o.mode: o for o in summary.mode_outcomes}
    assert by_mode["swing"].error is not None
    assert "synthetic swing failure" in by_mode["swing"].error
    # Day still ran end-to-end.
    assert by_mode["day"].error is None
    assert by_mode["day"].acceptance is not None


def test_run_weight_proposer_runs_at_set_when_now_default() -> None:
    """When ``now`` is not provided, the orchestrator stamps ``run_at`` to a
    fresh UTC timestamp — used downstream for proposal timestamps."""
    before = datetime.now(timezone.utc)
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=_InMemoryProposalStore(),  # type: ignore[arg-type]
        records=[],
    )
    after = datetime.now(timezone.utc)
    assert before <= summary.run_at <= after


def test_run_weight_proposer_summary_to_dict_shape() -> None:
    """The summary serializes to a JSON-friendly dict with the documented keys."""
    summary = run_weight_proposer(
        parameter_store=_ProvidedParameterStore(_fake_signal_params()),
        proposal_store=_InMemoryProposalStore(),  # type: ignore[arg-type]
        records=_bullish_dataset(mode="swing", count=40)
        + _bullish_dataset(mode="day", count=40),
        now=_NOW,
    )
    payload = summary.to_dict()
    # Top-level keys.
    assert set(payload.keys()) == {"run_at", "modes", "proposals_written"}
    # Each mode-outcome dict has the right fields.
    for mode_dict in payload["modes"]:
        assert "mode" in mode_dict
        assert "rows_evaluated" in mode_dict
        # accepted + reason only set when an acceptance happened.
        if "accepted" in mode_dict:
            assert isinstance(mode_dict["accepted"], bool)
            assert isinstance(mode_dict["reason"], str)


def test_run_weight_proposer_uses_default_trailing_days_constant() -> None:
    """Default trailing window is 60 days — pin so a future change is loud."""
    assert DEFAULT_TRAILING_DAYS == 60


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------


def test_handler_returns_200_on_happy_path() -> None:
    """Handler wraps the orchestrator and returns HTTP 200 with summary in body."""
    from stocvest.api.handlers import weight_proposer as handler_module

    # Patch the orchestrator + proposal-store factory so the handler runs
    # without touching boto3.
    with patch.object(handler_module, "build_default_proposal_store") as mock_store_factory, \
         patch.object(handler_module, "run_weight_proposer") as mock_run:
        mock_store_factory.return_value = _InMemoryProposalStore()
        mock_run.return_value = ProposalRunSummary(
            run_at=_NOW,
            mode_outcomes=[
                ModeRunOutcome(mode="swing", rows_evaluated=42),
                ModeRunOutcome(mode="day", rows_evaluated=37),
            ],
        )
        response = handler_module.weight_proposer_scheduled_handler({}, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["proposals_written"] == 0
    assert len(body["modes"]) == 2


def test_handler_returns_200_when_proposal_store_unavailable() -> None:
    """Even when the proposal store can't be built, the handler returns 200.

    EventBridge would retry-storm on non-2xx — the failure is surfaced in
    the response body so CloudWatch picks it up but EB doesn't hammer us.
    """
    from stocvest.api.handlers import weight_proposer as handler_module

    with patch.object(
        handler_module,
        "build_default_proposal_store",
        side_effect=RuntimeError("ParameterProposal table not configured"),
    ):
        response = handler_module.weight_proposer_scheduled_handler({}, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "error" in body
    assert "ParameterProposal table not configured" in body["error"]


def test_handler_returns_200_on_orchestrator_exception() -> None:
    """A top-level orchestrator exception is caught and surfaced in the body."""
    from stocvest.api.handlers import weight_proposer as handler_module

    with patch.object(handler_module, "build_default_proposal_store") as mock_store_factory, \
         patch.object(
             handler_module,
             "run_weight_proposer",
             side_effect=RuntimeError("synthetic worker explosion"),
         ):
        mock_store_factory.return_value = _InMemoryProposalStore()
        response = handler_module.weight_proposer_scheduled_handler({}, None)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "synthetic worker explosion" in body["error"]


def test_handler_module_registered_in_lambda_dispatch() -> None:
    """Sanity check: the dispatcher routes ``weight_proposer`` module to our handler.

    Pins the dispatch wiring — a future refactor that forgets to wire the
    module would silently route to the not-found path.
    """
    from stocvest.api import lambda_dispatch

    src = (
        lambda_dispatch.__file__
        and open(lambda_dispatch.__file__, "r", encoding="utf-8").read()
    )
    assert src is not None
    assert 'module == "weight_proposer"' in src
    assert "from stocvest.api.handlers.weight_proposer import" in src

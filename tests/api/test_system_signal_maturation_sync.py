"""Tests for platform-level system signal maturation sync."""

from __future__ import annotations

from stocvest.api.services.system_signal_maturation_sync import sync_system_signal_from_composite
from stocvest.data.system_signal_transition_repository import SystemSignalTransitionRepository
from stocvest.models.watchlist import WatchlistState
from tests.data.test_watchlist_maturation_transition_repository import _FakeDynamoTable


def _composite_body(*, layers: int = 4, summary: str = "bullish") -> dict:
    layer_rows = []
    for i, lid in enumerate(["technical", "news", "macro", "sector", "geopolitical", "internals"]):
        layer_rows.append(
            {
                "layer": lid,
                "status": "available",
                "score": 70 if i < layers else 40,
                "verdict": "bullish" if i < layers else "neutral",
            }
        )
    return {
        "status": "ok",
        "signal_summary": summary,
        "layers": layer_rows,
        "signal_score": 58,
        "generated_at": "2026-06-12T14:00:00+00:00",
    }


def test_system_sync_logs_initial_transition() -> None:
    table = _FakeDynamoTable()
    repo = SystemSignalTransitionRepository(table)
    body = _composite_body(layers=4)
    result = sync_system_signal_from_composite(
        symbol="SATS",
        mode="swing",
        composite_body=body,
        transition_repo=repo,
        evaluation_source="desk_batch",
    )
    assert result == "written"
    state = repo.get_state("SATS", "swing")
    assert state is not None
    assert state.state == WatchlistState.DEVELOPING
    rows = repo.list_for_symbol("SATS", "swing")
    assert len(rows) == 1
    assert rows[0].to_state == "developing"
    assert rows[0].evaluation_source == "desk_batch"


def test_system_sync_skips_unchanged_re_evaluation() -> None:
    table = _FakeDynamoTable()
    repo = SystemSignalTransitionRepository(table)
    body = _composite_body(layers=4)
    sync_system_signal_from_composite(symbol="SATS", mode="swing", composite_body=body, transition_repo=repo)
    sync_system_signal_from_composite(symbol="SATS", mode="swing", composite_body=body, transition_repo=repo)
    rows = repo.list_for_symbol("SATS", "swing")
    assert len(rows) == 1


def test_system_sync_logs_alignment_change() -> None:
    table = _FakeDynamoTable()
    repo = SystemSignalTransitionRepository(table)
    sync_system_signal_from_composite(
        symbol="SATS",
        mode="swing",
        composite_body=_composite_body(layers=3),
        transition_repo=repo,
    )
    sync_system_signal_from_composite(
        symbol="SATS",
        mode="swing",
        composite_body=_composite_body(layers=5),
        transition_repo=repo,
    )
    rows = repo.list_for_symbol("SATS", "swing")
    assert len(rows) == 2
    assert rows[-1].layers_aligned == 5

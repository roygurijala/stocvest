"""Unit tests for desk geometry tradeability gates."""

from __future__ import annotations

import pytest

from stocvest.api.services.geometry_tradeability import (
    annotate_setup_rows_surface_eligibility,
    filter_setups_bundle_by_geometry,
    filter_surface_eligible_setup_rows,
    geometry_tradeability,
    structure_rr_from_body,
)


def test_structure_rr_none_when_t1_too_close_and_t2_unanchored() -> None:
    body = {
        "signal_summary": "bullish",
        "last_trade_price": 72.76,
        "reference_stop_level": 62.13,
        "reference_target_1": 73.14,
        "reference_target_2": 73.76,
        "reference_target_2_provenance": "atr_extension",
    }
    assert structure_rr_from_body(body) is None


def test_geometry_tradeable_false_for_no_clean_entry() -> None:
    body = {
        "status": "active",
        "signal_summary": "bullish",
        "last_trade_price": 72.76,
        "reference_stop_level": 62.13,
        "reference_target_1": 73.14,
        "reference_target_2": 73.76,
        "reference_target_2_provenance": "atr_extension",
        "entry_zone_quality": "no_clean_entry",
        "min_rr_desk": 2.0,
    }
    ok, reason = geometry_tradeability(body, mode="swing")
    assert ok is False
    assert reason == "no_clean_entry"


def test_filter_setups_bundle_drops_ineligible_rows() -> None:
    bundle = {
        "qualifying": [
            {"symbol": "AAA", "desk_surface_eligible": True},
            {"symbol": "BBB", "desk_surface_eligible": False},
        ],
        "near_qualification": [{"symbol": "CCC", "desk_surface_eligible": False}],
    }
    out = filter_setups_bundle_by_geometry(bundle, mode="swing")
    assert [r["symbol"] for r in out["qualifying"]] == ["AAA"]
    assert out["near_qualification"] == []


def test_filter_surface_eligible_setup_rows() -> None:
    rows = [{"symbol": "X", "desk_surface_eligible": True}, {"symbol": "Y", "desk_surface_eligible": False}]
    assert [r["symbol"] for r in filter_surface_eligible_setup_rows(rows)] == ["X"]


@pytest.mark.unit
def test_annotate_setup_rows_without_cache_marks_ineligible(monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.data.dashboard_cache as dc

    monkeypatch.setattr(dc, "read_dashboard_cache", lambda _key: None)
    rows = annotate_setup_rows_surface_eligibility([{"symbol": "ZZZ"}], mode="swing")
    assert rows[0]["desk_surface_eligible"] is False
    assert rows[0]["geometry_block_reason"] == "missing_composite"

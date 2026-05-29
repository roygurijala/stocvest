"""Unit tests for corporate-action session price guard."""

from __future__ import annotations

import pytest

from stocvest.signals.session_price_guard import (
    is_corporate_action_session_move,
    price_ratio_suggests_split,
    sanitize_session_change_pct,
)


@pytest.mark.unit
def test_price_ratio_suggests_1_for_30_reverse_split() -> None:
    # QH-style artifact: $0.094 pre-split → ~$2.82 post-split (×30).
    assert price_ratio_suggests_split(0.094, 2.82) is True


@pytest.mark.unit
def test_price_ratio_ignores_normal_gap() -> None:
    assert price_ratio_suggests_split(100.0, 104.0) is False


@pytest.mark.unit
def test_qh_reverse_split_excluded() -> None:
    assert (
        is_corporate_action_session_move(
            0.094,
            2.82,
            gap_pct=2900.0,
            symbol="QH",
        )
        is True
    )


@pytest.mark.unit
def test_recent_split_symbol_list_excludes() -> None:
    assert (
        is_corporate_action_session_move(
            50.0,
            51.0,
            gap_pct=2.0,
            symbol="QH",
            recent_split_symbols=frozenset({"QH"}),
        )
        is True
    )


@pytest.mark.unit
def test_sanitize_session_change_pct_nulls_artifact() -> None:
    assert sanitize_session_change_pct(0.094, 2.82, 9261.7, symbol="QH") is None


@pytest.mark.unit
def test_sanitize_session_change_pct_keeps_real_move() -> None:
    assert sanitize_session_change_pct(100.0, 103.5, 3.5, symbol="AAPL") == pytest.approx(3.5)

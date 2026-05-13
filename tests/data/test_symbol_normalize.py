"""Unit tests for :mod:`stocvest.data.symbol_normalize`.

The rule under test is deliberately conservative: only the
class-share dash pattern (``[A-Z]+-[A-Z]``) gets rewritten with a
dot. Everything else must pass through untouched so we do not
accidentally mangle preferred shares, index symbols, or anything
exotic that Polygon happens to accept in a different form.

Pins the BRK-B regression (2026-05-13). With the dash form Polygon's
aggregates and snapshot endpoints both returned ``404`` / empty
results, which silently flipped two layers to ``unavailable`` and
collapsed the composite to neutral.
"""

from __future__ import annotations

import pytest

from stocvest.data.symbol_normalize import to_polygon_symbol


# ---------------------------------------------------------------------------
# Class-share dash → dot (the bug the helper exists for)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("BRK-B", "BRK.B"),
        ("BRK-A", "BRK.A"),
        ("RDS-A", "RDS.A"),
        ("BF-B", "BF.B"),
        ("HEI-A", "HEI.A"),
    ],
)
def test_class_share_dash_is_rewritten_to_dot(raw: str, expected: str) -> None:
    assert to_polygon_symbol(raw) == expected


# ---------------------------------------------------------------------------
# Already-canonical / unaffected symbols
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sym",
    [
        "AAPL",
        "MSFT",
        "SPY",
        "XLF",
        "BRK.B",      # already dot
        "BRK.A",
        "I:VIX",      # index ticker (colon prefix)
        "^VIX",       # legacy index notation
    ],
)
def test_already_canonical_symbols_are_unchanged(sym: str) -> None:
    assert to_polygon_symbol(sym) == sym


# ---------------------------------------------------------------------------
# Edge cases the rule must NOT touch (multi-letter suffixes, etc.)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sym",
    [
        "JPM-PRD",        # preferred-share class — multi-letter, leave alone
        "GS-PRJ",
        "FOO-BAR",
        "A-BC",
    ],
)
def test_multi_letter_suffixes_are_left_alone(sym: str) -> None:
    assert to_polygon_symbol(sym) == sym


# ---------------------------------------------------------------------------
# Hygiene: strip/upper + idempotency + empty input
# ---------------------------------------------------------------------------


def test_strips_whitespace_and_uppercases() -> None:
    assert to_polygon_symbol("  brk-b  ") == "BRK.B"
    assert to_polygon_symbol("brk.b") == "BRK.B"


def test_is_idempotent() -> None:
    assert to_polygon_symbol(to_polygon_symbol("BRK-B")) == "BRK.B"
    assert to_polygon_symbol(to_polygon_symbol("AAPL")) == "AAPL"


def test_empty_input_passes_through() -> None:
    assert to_polygon_symbol("") == ""

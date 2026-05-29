"""Corporate actions — frequent reverse split detection."""

from __future__ import annotations

from datetime import date

from stocvest.data.corporate_actions import SplitEvent, _parse_split_row


def test_parse_split_row_reverse() -> None:
    row = {
        "ticker": "qh",
        "execution_date": "2026-05-20",
        "split_from": 30.0,
        "split_to": 1.0,
    }
    ev = _parse_split_row(row)
    assert ev is not None
    assert ev.ticker == "QH"
    assert ev.is_reverse is True


def test_parse_split_row_forward() -> None:
    row = {
        "ticker": "AAPL",
        "execution_date": "2026-01-01",
        "split_from": 1.0,
        "split_to": 4.0,
    }
    ev = _parse_split_row(row)
    assert ev is not None
    assert ev.is_reverse is False


def test_split_event_properties() -> None:
    ev = SplitEvent(ticker="X", execution_date=date(2026, 1, 1), split_from=10.0, split_to=1.0)
    assert ev.is_reverse is True

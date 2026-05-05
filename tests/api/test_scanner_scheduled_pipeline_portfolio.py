"""Scheduled scanner → portfolio composite hook."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.api.services.scanner_scheduled_pipeline import (
    qualifying_tickers_from_scheduled_scan_document,
    _run_portfolio_composite_for_qualifying_tickers,
)


def test_qualifying_tickers_premarket_gaps() -> None:
    doc = {"data": {"gaps": [{"symbol": "aa"}, {"symbol": "BB"}, {"symbol": "aa"}]}}
    assert qualifying_tickers_from_scheduled_scan_document(doc, "premarket") == ["AA", "BB"]


def test_qualifying_tickers_intraday_setups() -> None:
    doc = {"data": {"setups": [{"symbol": "msft"}, {"symbol": "NVDA"}]}}
    assert qualifying_tickers_from_scheduled_scan_document(doc, "intraday") == ["MSFT", "NVDA"]


def test_portfolio_hook_skips_on_scan_error(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_run = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.portfolio_reversal.run_portfolio_scanner_for_symbol",
        mock_run,
    )
    doc = {"data": {"error": "polygon down"}}
    _run_portfolio_composite_for_qualifying_tickers(document=doc, scan_type="premarket")
    mock_run.assert_not_called()


def test_portfolio_hook_calls_per_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_run = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.portfolio_reversal.run_portfolio_scanner_for_symbol",
        mock_run,
    )
    doc = {"data": {"gaps": [{"symbol": "X"}, {"symbol": "Y"}]}}
    _run_portfolio_composite_for_qualifying_tickers(document=doc, scan_type="premarket")
    mock_run.assert_any_call("X")
    mock_run.assert_any_call("Y")
    assert mock_run.call_count == 2

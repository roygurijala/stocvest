"""Model portfolio recorder — DynamoDB mocked (no real AWS)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from stocvest.api.services.portfolio_entry_reason import build_entry_reason_from_layer_results
from stocvest.api.services.portfolio_recorder import (
    CONFLUENCE_BONUS,
    PORTFOLIO_NOTIONAL,
    SIGNAL_SIZE_MAP,
    STOP_LOSS_PCT,
    TARGET_PCT,
    ExitReason,
    PortfolioRecorder,
    PositionOutcome,
    PositionStatus,
    _compute_notional,
)


class TechnicalLayerResult:
    status = "available"
    verdict = "bullish"
    reasoning = "ORB reclaim and VWAP above session mean"


class NewsLayerResult:
    status = "available"
    verdict = "bullish"
    reasoning = "Earnings catalyst positive"


def test_entry_reason_built_from_layers():
    text = build_entry_reason_from_layer_results([TechnicalLayerResult(), NewsLayerResult()])
    assert "Technical" in text or "ORB" in text
    assert "News" in text or "Earnings" in text


def _mock_resource(table: MagicMock):
    res = MagicMock()
    res.Table.return_value = table
    return res


def test_position_opened_above_minimum_score():
    table = MagicMock()
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        table.query.return_value = {"Items": []}
        pid = rec.open_position(
            symbol="AAPL",
            entry_price=100.0,
            signal_score=75,
            entry_reason="test",
            layer_scores={"technical": 80},
            layer_verdicts={"technical": "bullish"},
            layer_chips={"technical": ["RSI 60"]},
            confluence_fired=False,
            confluence_score=0,
            market_regime="neutral",
            vix_at_entry=18.0,
            spy_day_pct=0.5,
            sector_etf="XLK",
            sector_day_pct=0.3,
            parameter_version="1.0.0",
        )
        assert pid is not None
        assert table.put_item.called
        assert table.update_item.called  # summary open increment


def test_position_rejected_below_minimum():
    table = MagicMock()
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        table.query.return_value = {"Items": []}
        pid = rec.open_position(
            symbol="AAPL",
            entry_price=100.0,
            signal_score=71,
            entry_reason="test",
            layer_scores={},
            layer_verdicts={},
            layer_chips={},
            confluence_fired=False,
            confluence_score=0,
            market_regime="neutral",
            vix_at_entry=None,
            spy_day_pct=None,
            sector_etf=None,
            sector_day_pct=None,
            parameter_version="1.0.0",
        )
        assert pid is None
        assert not table.put_item.called


def test_position_rejected_at_max_capacity():
    table = MagicMock()
    fake_open = [{"symbol": "X" + str(i)} for i in range(10)]
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        table.query.return_value = {"Items": fake_open}
        pid = rec.open_position(
            symbol="NVDA",
            entry_price=100.0,
            signal_score=80,
            entry_reason="test",
            layer_scores={},
            layer_verdicts={},
            layer_chips={},
            confluence_fired=False,
            confluence_score=0,
            market_regime="neutral",
            vix_at_entry=None,
            spy_day_pct=None,
            sector_etf=None,
            sector_day_pct=None,
            parameter_version="1.0.0",
        )
        assert pid is None


def test_position_rejected_duplicate_symbol():
    table = MagicMock()

    def _query(**kwargs):
        idx = kwargs.get("IndexName")
        fe = str(kwargs.get("FilterExpression") or "")
        if idx == "symbol-entry-index" and ":open" in str(kwargs.get("ExpressionAttributeValues", {})):
            return {"Items": [{"symbol": "AAPL", "position_id": "x", "status": "open"}]}
        if idx == "status-entry-index":
            return {"Items": []}
        return {"Items": []}

    table.query.side_effect = _query
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        pid = rec.open_position(
            symbol="AAPL",
            entry_price=100.0,
            signal_score=80,
            entry_reason="test",
            layer_scores={},
            layer_verdicts={},
            layer_chips={},
            confluence_fired=False,
            confluence_score=0,
            market_regime="neutral",
            vix_at_entry=None,
            spy_day_pct=None,
            sector_etf=None,
            sector_day_pct=None,
            parameter_version="1.0.0",
        )
        assert pid is None


def test_notional_size_by_signal_strength():
    assert _compute_notional(75, False) == SIGNAL_SIZE_MAP["moderate"]
    assert _compute_notional(85, False) == SIGNAL_SIZE_MAP["strong"]
    assert _compute_notional(92, False) == SIGNAL_SIZE_MAP["very_strong"]


def test_confluence_bonus_applied():
    base = SIGNAL_SIZE_MAP["strong"]
    assert _compute_notional(85, True) == base + CONFLUENCE_BONUS


def test_notional_capped_at_10_pct():
    raw = SIGNAL_SIZE_MAP["very_strong"] + CONFLUENCE_BONUS
    assert raw == 10_000.0
    assert _compute_notional(92, True) == PORTFOLIO_NOTIONAL * 0.10


def test_stop_and_target_at_entry():
    entry = 100.0
    assert round(entry * (1 - STOP_LOSS_PCT), 2) == 93.0
    assert round(entry * (1 + TARGET_PCT), 2) == 115.0


def test_position_closed_stop_loss():
    table = MagicMock()
    now = datetime.now(timezone.utc)
    item = {
        "pk": "PORTFOLIO#v1",
        "sk": "POSITION#abc",
        "position_id": "abc",
        "symbol": "AAPL",
        "status": PositionStatus.OPEN.value,
        "entry_date": now.isoformat(),
        "entry_price": "100",
        "notional_size": "5000",
        "shares_equivalent": "50",
        "signal_score": 75,
        "signal_strength": "moderate",
        "entry_reason": "test",
        "layer_scores_json": "{}",
        "layer_verdicts_json": "{}",
        "layer_chips_json": "{}",
        "confluence_fired": False,
        "confluence_score": 0,
        "market_regime": "neutral",
        "parameter_version": "1.0.0",
        "stop_loss_price": "93",
        "target_price": "115",
    }
    table.get_item.side_effect = [{"Item": item}, {"Item": {}}]
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        ok = rec.close_position("abc", 92.0, ExitReason.STOP_LOSS)
        assert ok
        assert table.update_item.called
        args, kwargs = table.update_item.call_args
        vals = kwargs["ExpressionAttributeValues"]
        assert vals[":oc"] == PositionOutcome.LOSS.value
        assert vals[":swc"] is False


def test_r_multiple_calculated_correctly():
    table = MagicMock()
    now = datetime.now(timezone.utc)
    item = {
        "position_id": "abc",
        "symbol": "AAPL",
        "status": PositionStatus.OPEN.value,
        "entry_date": now.isoformat(),
        "entry_price": "100",
        "notional_size": "7000",
        "shares_equivalent": "70",
        "signal_score": 85,
        "signal_strength": "strong",
        "entry_reason": "t",
        "layer_scores_json": "{}",
        "layer_verdicts_json": "{}",
        "layer_chips_json": "{}",
        "confluence_fired": False,
        "confluence_score": 0,
        "market_regime": "neutral",
        "parameter_version": "1.0.0",
        "stop_loss_price": "93",
        "target_price": "115",
    }
    table.get_item.side_effect = [{"Item": item}, {"Item": {}}]
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        rec.close_position("abc", 114.0, ExitReason.TARGET_REACHED)
        vals = table.update_item.call_args[1]["ExpressionAttributeValues"]
        assert float(vals[":rm"]) == pytest.approx(2.0, rel=0.01)


def test_summary_updated_after_close():
    table = MagicMock()
    now = datetime.now(timezone.utc)
    item = {
        "position_id": "abc",
        "symbol": "AAPL",
        "status": PositionStatus.OPEN.value,
        "entry_date": now.isoformat(),
        "entry_price": "100",
        "notional_size": "5000",
        "shares_equivalent": "50",
        "signal_score": 75,
        "signal_strength": "moderate",
        "entry_reason": "t",
        "layer_scores_json": "{}",
        "layer_verdicts_json": "{}",
        "layer_chips_json": "{}",
        "confluence_fired": False,
        "confluence_score": 0,
        "market_regime": "neutral",
        "parameter_version": "1.0.0",
        "stop_loss_price": "93",
        "target_price": "115",
    }
    table.get_item.side_effect = [{"Item": item}, {"Item": {}}]
    with patch("stocvest.api.services.portfolio_recorder.boto3.resource", return_value=_mock_resource(table)):
        rec = PortfolioRecorder()
        rec.close_position("abc", 110.0, ExitReason.TARGET_REACHED)
        assert table.put_item.called
        summary_item = table.put_item.call_args[1]["Item"]
        assert int(summary_item.get("winning_positions") or 0) >= 1

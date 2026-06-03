"""Validation ledger lifecycle: open position, rule-based close, resolve_signals skip."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from botocore.exceptions import ClientError

from stocvest.api.services.signal_recorder import (
    DynamoDBSignalRecorder,
    InMemorySignalRecorder,
    outcome_from_prices,
)
from stocvest.data.models import SignalRecord


def test_resolve_signals_skips_open_validation_row() -> None:
    rec = InMemorySignalRecorder()
    past = datetime.now(timezone.utc) - timedelta(hours=3)
    rec.record_signal(
        SignalRecord(
            signal_id="open1",
            symbol="ZZZ",
            direction="bullish",
            signal_strength=80,
            pattern="test",
            layer_scores={"technical": 0.5},
            price_at_signal=100.0,
            generated_at=past,
            user_id="u-open",
            ledger_qualified=True,
            ledger_position_open=True,
        )
    )

    class _FakePoly:
        async def get_evaluated_price_after_signal(self, symbol: str, generated_at: datetime, *, horizon: str) -> float:
            return 110.0

    n = asyncio.run(rec.resolve_signals(60, _FakePoly(), horizon="1h"))
    assert n == 0
    raw = rec._items["open1"]
    assert not raw.get("resolved_1h")


def test_close_validation_position_day() -> None:
    rec = InMemorySignalRecorder()
    gen = datetime.now(timezone.utc) - timedelta(minutes=30)
    rec.record_signal(
        SignalRecord(
            signal_id="c1",
            symbol="AAA",
            direction="bullish",
            signal_strength=80,
            pattern="test",
            layer_scores={},
            price_at_signal=100.0,
            generated_at=gen,
            user_id="u1",
            ledger_qualified=True,
            ledger_position_open=True,
            mode="day",
        )
    )
    now = datetime.now(timezone.utc)
    ok = rec.close_validation_position(
        signal_id="c1",
        exit_price=105.0,
        exit_rule="day_test",
        exit_reason="unit test",
        mode="day",
        now=now,
    )
    assert ok
    got = rec.get_signal_record_raw("c1")
    assert got is not None
    assert got.closed_at is not None
    assert got.ledger_position_open is False
    assert got.validation_outcome == "favorable"
    assert got.outcome_1h == outcome_from_prices("bullish", 100.0, 105.0)
    assert got.exit_rule == "day_test"


class _FakeDynamoTable:
    """Captures update_item and mimics DynamoDB's unused-name validation."""

    def __init__(self, item: dict) -> None:
        self._item = item
        self.last_update: dict | None = None

    def get_item(self, Key):  # noqa: N803 - boto3 kwarg casing
        return {"Item": self._item}

    def update_item(self, **kwargs):
        self.last_update = kwargs
        names = kwargs.get("ExpressionAttributeNames", {}) or {}
        vals = kwargs.get("ExpressionAttributeValues", {}) or {}
        expr = (
            f"{kwargs.get('UpdateExpression', '')} {kwargs.get('ConditionExpression', '')}"
        )
        unused_names = [k for k in names if k not in expr]
        unused_vals = [k for k in vals if k not in expr]
        if unused_names or unused_vals:
            raise ClientError(
                {
                    "Error": {
                        "Code": "ValidationException",
                        "Message": (
                            "Value provided in ExpressionAttributeNames unused in "
                            f"expressions: keys: {{{', '.join(unused_names)}}}"
                        ),
                    }
                },
                "UpdateItem",
            )
        return {}


@pytest.mark.parametrize(
    ("mode", "used_trio", "unused_trio"),
    [
        ("swing", ("#p1d", "#o1d", "#r1d"), ("#p1h", "#o1h", "#r1h")),
        ("day", ("#p1h", "#o1h", "#r1h"), ("#p1d", "#o1d", "#r1d")),
    ],
)
def test_dynamo_close_validation_position_no_unused_names(mode, used_trio, unused_trio) -> None:
    """Regression: DynamoDB update must not declare ExpressionAttributeNames it never uses."""
    gen = datetime.now(timezone.utc) - timedelta(minutes=45)
    item = {
        "signal_id": "d1",
        "generated_at": gen.isoformat().replace("+00:00", "Z"),
        "direction": "bullish",
        "price_at_signal": 100.0,
    }
    table = _FakeDynamoTable(item)
    rec = DynamoDBSignalRecorder(table=table)

    ok = rec.close_validation_position(
        signal_id="d1",
        exit_price=110.0,
        exit_rule="rule",
        exit_reason="unit test",
        mode=mode,
        now=datetime.now(timezone.utc),
    )

    assert ok is True
    assert table.last_update is not None
    names = table.last_update["ExpressionAttributeNames"]
    expr = table.last_update["UpdateExpression"]
    for alias in used_trio:
        assert alias in names and alias in expr
    for alias in unused_trio:
        assert alias not in names


def test_has_open_validation_position() -> None:
    rec = InMemorySignalRecorder()
    rec.record_signal(
        SignalRecord(
            signal_id="o1",
            symbol="IBM",
            direction="bullish",
            signal_strength=50,
            pattern="p",
            layer_scores={},
            price_at_signal=1.0,
            generated_at=datetime.now(timezone.utc),
            user_id="ux",
            ledger_qualified=True,
            ledger_position_open=True,
            mode="swing",
        )
    )
    assert rec.has_open_validation_position("ux", "IBM", "swing") is True
    assert rec.has_open_validation_position("ux", "IBM", "day") is False

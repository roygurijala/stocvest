from __future__ import annotations

from datetime import date

import pytest

from stocvest.models.portfolio_holding import (
    MAX_LOTS_PER_SYMBOL,
    HoldingLot,
    PortfolioHolding,
    PortfolioSettings,
    apply_stock_split,
)

pytestmark = pytest.mark.unit


def _lot(**kw: object) -> dict[str, object]:
    base: dict[str, object] = {
        "lotId": "l1",
        "quantity": 10,
        "costBasis": 100.0,
        "purchaseDate": "2024-01-15",
    }
    base.update(kw)
    return base


def test_holding_derived_totals_and_average_cost() -> None:
    holding = PortfolioHolding.from_api(
        {
            "symbol": "aapl",
            "lots": [
                _lot(lotId="l1", quantity=10, costBasis=100.0, purchaseDate="2024-01-15"),
                _lot(lotId="l2", quantity=30, costBasis=200.0, purchaseDate="2025-06-01"),
            ],
        }
    )
    assert holding.symbol == "AAPL"  # normalized upper
    assert holding.total_quantity == 40
    assert holding.total_cost == 7000.0  # 10*100 + 30*200
    assert holding.average_cost == 175.0  # 7000 / 40
    assert holding.earliest_purchase_date() == "2024-01-15"


def test_holding_lot_holding_period_and_long_term_flag() -> None:
    lot = HoldingLot.from_api(_lot(purchaseDate="2024-01-01"))
    as_of = date(2025, 6, 1)  # > 365 days later
    assert lot.holding_period_days(as_of=as_of) == 517
    assert lot.is_long_term(as_of=as_of) is True

    recent = HoldingLot.from_api(_lot(purchaseDate="2025-05-01"))
    assert recent.is_long_term(as_of=as_of) is False


def test_holding_round_trip_through_dynamo_item() -> None:
    holding = PortfolioHolding.from_api({"symbol": "MSFT", "lots": [_lot()]})
    restored = PortfolioHolding.from_dynamo_item(holding.to_dynamo_item())
    assert restored.symbol == "MSFT"
    assert restored.lots[0].cost_basis == 100.0
    assert restored.lots[0].purchase_date == "2024-01-15"


def test_holding_api_shape_includes_derived_fields() -> None:
    api = PortfolioHolding.from_api({"symbol": "NVDA", "lots": [_lot()]}).to_api()
    assert api["symbol"] == "NVDA"
    assert api["totalQuantity"] == 10
    assert api["averageCost"] == 100.0
    assert api["lots"][0]["lotId"] == "l1"


@pytest.mark.parametrize(
    "bad",
    [
        {"symbol": "", "lots": [_lot()]},
        {"symbol": "AAPL", "lots": []},
        {"symbol": "AAPL"},
        {"symbol": "AAPL", "lots": [_lot(quantity=0)]},
        {"symbol": "AAPL", "lots": [_lot(quantity=-5)]},
        {"symbol": "AAPL", "lots": [_lot(costBasis=-1)]},
        {"symbol": "AAPL", "lots": [_lot(lotId="")]},
        {"symbol": "AAPL", "lots": [_lot(purchaseDate="")]},
    ],
)
def test_holding_rejects_invalid_payloads(bad: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        PortfolioHolding.from_api(bad)


def test_holding_rejects_too_many_lots() -> None:
    lots = [_lot(lotId=f"l{i}") for i in range(MAX_LOTS_PER_SYMBOL + 1)]
    with pytest.raises(ValueError):
        PortfolioHolding.from_api({"symbol": "AAPL", "lots": lots})


def test_holding_accepts_iso_datetime_purchase_date() -> None:
    lot = HoldingLot.from_api(_lot(purchaseDate="2024-03-02T15:30:00Z"))
    assert lot.purchase_date == "2024-03-02"


def test_settings_defaults() -> None:
    s = PortfolioSettings.from_api(None)
    assert s.cash_balance == 0.0
    assert s.target_position_pct is None
    assert s.benchmark_symbol == "SPY"
    assert s.to_api() == {
        "cashBalance": 0.0,
        "targetPositionPct": None,
        "benchmarkSymbol": "SPY",
    }


def test_settings_parses_and_normalizes() -> None:
    s = PortfolioSettings.from_api(
        {"cashBalance": 12345.678, "targetPositionPct": 5, "benchmarkSymbol": "qqq"}
    )
    assert s.cash_balance == 12345.68  # rounded to cents
    assert s.target_position_pct == 5.0
    assert s.benchmark_symbol == "QQQ"


def test_settings_round_trip_through_dynamo_item() -> None:
    s = PortfolioSettings(cash_balance=2500.0, target_position_pct=8.0, benchmark_symbol="IWM")
    restored = PortfolioSettings.from_dynamo_item(s.to_dynamo_item())
    assert restored == s


@pytest.mark.parametrize(
    "bad",
    [
        {"cashBalance": -1},
        {"targetPositionPct": 0},
        {"targetPositionPct": 100.1},
        {"benchmarkSymbol": "not a ticker!"},
    ],
)
def test_settings_rejects_invalid(bad: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        PortfolioSettings.from_api(bad)


def test_apply_stock_split_forward_preserves_total_cost_and_dates() -> None:
    holding = PortfolioHolding.from_api(
        {
            "symbol": "AAPL",
            "lots": [
                _lot(lotId="a", quantity=10, costBasis=180.0, purchaseDate="2023-01-02"),
                _lot(lotId="b", quantity=5, costBasis=200.0, purchaseDate="2024-03-04"),
            ],
        }
    )
    split = apply_stock_split(holding, ratio=2.0)  # 2:1 forward
    assert split.total_quantity == 30  # 20 + 10
    assert split.total_cost == holding.total_cost  # 1800 + 1000 = 2800, unchanged
    by_id = {lot.lot_id: lot for lot in split.lots}
    assert by_id["a"].quantity == 20 and by_id["a"].cost_basis == 90.0
    assert by_id["a"].purchase_date == "2023-01-02"  # tax holding period untouched
    assert by_id["b"].quantity == 10 and by_id["b"].cost_basis == 100.0


def test_apply_stock_split_reverse() -> None:
    holding = PortfolioHolding.from_api(
        {"symbol": "AAPL", "lots": [_lot(quantity=100, costBasis=5.0)]}
    )
    split = apply_stock_split(holding, ratio=0.1)  # 1:10 reverse
    assert split.total_quantity == 10
    assert split.lots[0].cost_basis == 50.0
    assert split.total_cost == holding.total_cost


@pytest.mark.parametrize("bad", [0, -1, -0.5])
def test_apply_stock_split_rejects_nonpositive_ratio(bad: float) -> None:
    holding = PortfolioHolding.from_api({"symbol": "AAPL", "lots": [_lot()]})
    with pytest.raises(ValueError):
        apply_stock_split(holding, ratio=bad)

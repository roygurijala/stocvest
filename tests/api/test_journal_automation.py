from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from stocvest.api.handlers.orders import orders_submit_handler
from stocvest.api.services.journal_store import InMemoryJournalStore
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderSide,
    OrderStatus,
    PlaceOrderRequest,
)
from stocvest.data.models import TradingMode
from stocvest.signals.trade_journal import (
    TradeJournal,
    TradeJournalEntryStatus,
    TradeOpeningSide,
    compute_journal_analytics,
)
import stocvest.api.services.journal_order_hooks as journal_order_hooks_mod
from stocvest.api.services import user_profile_store as ups_mod


class _FakeAdapter:
    def __init__(self) -> None:
        self._orders: dict[str, OrderStatus] = {}

    async def connect(self, config: dict[str, Any]) -> None:
        _ = config

    async def disconnect(self) -> None:
        return None

    async def health_check(self) -> BrokerHealth:
        return BrokerHealth(ok=True)

    async def list_accounts(self) -> list[BrokerAccount]:
        return [BrokerAccount(account_id="A1", display_name="Paper")]

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        return []

    async def place_order(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        self._orders[request.client_order_id] = OrderStatus(
            client_order_id=request.client_order_id,
            broker_order_id="B-1",
            status=OrderLifecycleStatus.FILLED,
            symbol=request.symbol.upper(),
            side=request.side,
            quantity_ordered=request.quantity,
            quantity_filled=float(request.quantity),
            average_fill_price=100.0,
        )
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id="B-1",
            average_fill_price=100.0,
            quantity_filled=float(request.quantity),
        )

    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        return self._orders[client_order_id]


class _RecordingFactory:
    @staticmethod
    def create(kind: str) -> _FakeAdapter:
        return _FakeAdapter()


class _NoopGatewayProvider:
    @staticmethod
    def build_connect_config(broker_kind: str) -> dict[str, Any]:
        _ = broker_kind
        return {}


class _PolygonStub:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        _ = args, kwargs

    async def __aenter__(self) -> Any:
        from stocvest.data.models import MarketStatus

        class Ctx:
            async def get_market_status(self) -> MarketStatus:
                from datetime import datetime, timezone

                return MarketStatus(
                    market="stocks",
                    server_time=datetime.now(tz=timezone.utc),
                    exchanges={"NYSE": "open"},
                    currencies={},
                )

            async def get_ticker_details(self, symbol: str) -> dict[str, Any]:
                return {"type": "CS", "ticker": symbol}

            async def get_snapshot(self, symbol: str) -> Any:
                from stocvest.data.models import Snapshot

                return Snapshot(symbol=symbol, last_quote_bid=100.0, last_quote_ask=100.2, last_trade_price=100.1)

        return Ctx()

    async def __aexit__(self, *a: object) -> None:
        return None


def _submit_event(user_sub: str, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": user_sub}}}},
        "body": json.dumps(body),
    }


@pytest.fixture
def fresh_journal(monkeypatch: pytest.MonkeyPatch) -> InMemoryJournalStore:
    store = InMemoryJournalStore(TradeJournal())
    monkeypatch.setattr(journal_order_hooks_mod, "get_trade_journal_store", lambda: store)
    return store


def test_journal_entry_created_on_order_fill(fresh_journal: InMemoryJournalStore, monkeypatch: pytest.MonkeyPatch) -> None:
    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("u-journal-1", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    body = {
        "symbol": "AAPL",
        "side": "buy",
        "quantity": 100,
        "order_type": "market",
        "account_id": "A1",
        "broker": "mock",
        "confirmed": True,
        "is_day_trade": False,
        "client_order_id": "cj-1",
    }
    resp = orders_submit_handler(
        _submit_event("u-journal-1", body), {}, factory=_RecordingFactory, gateway_provider=_NoopGatewayProvider()
    )
    assert resp["statusCode"] == 200
    rows = fresh_journal.journal.entries_for_user("u-journal-1")
    assert len(rows) == 1
    assert rows[0].symbol == "AAPL"
    assert rows[0].status == TradeJournalEntryStatus.OPEN
    assert rows[0].entry_price_avg == pytest.approx(100.0)


def test_journal_entry_closed_on_exit_order(fresh_journal: InMemoryJournalStore, monkeypatch: pytest.MonkeyPatch) -> None:
    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("u-journal-2", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    orders_submit_handler(
        _submit_event(
            "u-journal-2",
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 100,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "cj-open",
            },
        ),
        {},
        factory=_RecordingFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    orders_submit_handler(
        _submit_event(
            "u-journal-2",
            {
                "symbol": "AAPL",
                "side": "sell",
                "quantity": 100,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "cj-close",
            },
        ),
        {},
        factory=_RecordingFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    rows = fresh_journal.journal.entries_for_user("u-journal-2")
    assert len(rows) == 1
    assert rows[0].status == TradeJournalEntryStatus.CLOSED
    assert rows[0].pnl_realized_usd == pytest.approx(0.0)


def test_pnl_correct_for_winning_long(fresh_journal: InMemoryJournalStore, monkeypatch: pytest.MonkeyPatch) -> None:
    class WinAdapter(_FakeAdapter):
        async def place_order(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
            px = 100.0 if request.side == OrderSide.BUY else 105.0
            self._orders[request.client_order_id] = OrderStatus(
                client_order_id=request.client_order_id,
                broker_order_id="B-1",
                status=OrderLifecycleStatus.FILLED,
                symbol=request.symbol.upper(),
                side=request.side,
                quantity_ordered=request.quantity,
                quantity_filled=float(request.quantity),
                average_fill_price=px,
            )
            return OrderAck(
                client_order_id=request.client_order_id,
                broker_order_id="B-1",
                average_fill_price=px,
                quantity_filled=float(request.quantity),
            )

    class WinFactory:
        @staticmethod
        def create(kind: str) -> WinAdapter:
            return WinAdapter()

    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("u-j3", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    orders_submit_handler(
        _submit_event(
            "u-j3",
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 100,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "o1",
            },
        ),
        {},
        factory=WinFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    orders_submit_handler(
        _submit_event(
            "u-j3",
            {
                "symbol": "AAPL",
                "side": "sell",
                "quantity": 100,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "o2",
            },
        ),
        {},
        factory=WinFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    row = fresh_journal.journal.entries_for_user("u-j3")[0]
    assert row.outcome == "win"
    assert row.pnl_realized_usd == pytest.approx(500.0)


def test_signal_id_linked_when_context_provided(fresh_journal: InMemoryJournalStore, monkeypatch: pytest.MonkeyPatch) -> None:
    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("u-j4", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    orders_submit_handler(
        _submit_event(
            "u-j4",
            {
                "symbol": "MSFT",
                "side": "buy",
                "quantity": 10,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "sig-1",
                "signal_id": "sig-uuid-1",
                "signal_strength": 82,
                "confluence_score": 91,
                "pattern": "orb_breakout_long",
                "signal_direction": "bullish",
            },
        ),
        {},
        factory=_RecordingFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    row = fresh_journal.journal.entries_for_user("u-j4")[0]
    assert row.signal_id == "sig-uuid-1"
    assert row.signal_strength == 82
    assert row.confluence_score == 91
    assert row.setup_type == "orb_breakout_long"


def test_journal_capture_never_blocks_order(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> InMemoryJournalStore:
        raise RuntimeError("journal down")

    monkeypatch.setattr(journal_order_hooks_mod, "get_trade_journal_store", boom)
    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("u-j5", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    resp = orders_submit_handler(
        _submit_event(
            "u-j5",
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": True,
                "is_day_trade": False,
                "client_order_id": "boom-1",
            },
        ),
        {},
        factory=_RecordingFactory,
        gateway_provider=_NoopGatewayProvider(),
    )
    assert resp["statusCode"] == 200


def test_analytics_win_rate_and_expectancy() -> None:
    from stocvest.signals.trade_journal import TradeJournalEntry, TradeJournalEntryStatus, close_trade_journal_entry

    base = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)

    def closed(sym: str, pnl: float, *, day: int, setup: str | None = None) -> Any:
        o = TradeJournalEntry(
            entry_id=f"{sym}-{day}",
            user_id="u",
            symbol=sym,
            opening_side=TradeOpeningSide.BUY,
            quantity=1,
            opened_at=base,
            status=TradeJournalEntryStatus.OPEN,
            entry_price_avg=100.0,
            setup_type=setup,
        )
        return close_trade_journal_entry(
            o,
            closed_at=base.replace(day=day),
            exit_price_avg=100.0 + pnl,
            pnl_realized_usd=pnl,
        )

    wins = [closed("A", 200, day=2 + i, setup="vwap_reclaim") for i in range(3)]
    losses = [closed("B", -100, day=10 + i, setup="orb_breakout_long") for i in range(2)]
    entries = tuple(wins + losses)
    a = compute_journal_analytics(entries, user_id="u", disclaimer="d")
    assert a.win_rate == pytest.approx(0.6)
    assert a.expectancy == pytest.approx(0.6 * 200 - 0.4 * 100)


def test_analytics_streak_positive() -> None:
    from stocvest.signals.trade_journal import TradeJournalEntry, TradeJournalEntryStatus, close_trade_journal_entry

    base = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
    rows = []
    for i, pnl in enumerate([50, 30, 10]):
        o = TradeJournalEntry(
            entry_id=f"w{i}",
            user_id="u",
            symbol="S",
            opening_side=TradeOpeningSide.BUY,
            quantity=1,
            opened_at=base,
            status=TradeJournalEntryStatus.OPEN,
            entry_price_avg=10.0,
        )
        rows.append(
            close_trade_journal_entry(
                o,
                closed_at=datetime(2026, 5, 2, 10 + i, 0, tzinfo=timezone.utc),
                exit_price_avg=10.0 + pnl,
                pnl_realized_usd=float(pnl),
            )
        )
    a = compute_journal_analytics(tuple(reversed(rows)), user_id="u", disclaimer="d")
    assert a.current_streak == 3


def test_analytics_best_setup_requires_min_2() -> None:
    from stocvest.signals.trade_journal import TradeJournalEntry, TradeJournalEntryStatus, close_trade_journal_entry

    base = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)

    def one(eid: str, setup: str, pnl: float) -> Any:
        o = TradeJournalEntry(
            entry_id=eid,
            user_id="u",
            symbol="S",
            opening_side=TradeOpeningSide.BUY,
            quantity=1,
            opened_at=base,
            status=TradeJournalEntryStatus.OPEN,
            entry_price_avg=50.0,
            setup_type=setup,
        )
        return close_trade_journal_entry(
            o,
            closed_at=datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc),
            exit_price_avg=50.0 + pnl,
            pnl_realized_usd=pnl,
        )

    entries = (
        one("1", "orb_breakout_long", 100),
        one("2", "vwap_reclaim", 50),
        one("3", "vwap_reclaim", 70),
    )
    a = compute_journal_analytics(entries, user_id="u", disclaimer="d")
    assert a.best_setup_type == "vwap_reclaim"

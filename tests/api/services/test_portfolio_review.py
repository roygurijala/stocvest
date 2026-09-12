"""Unit tests for the portfolio review engine (offline; all data injected)."""

from __future__ import annotations

import asyncio
from datetime import date

import pytest

from stocvest.api.services.portfolio_review import (
    BenchmarkComparison,
    ReviewAction,
    _build_spy_close_lookup,
    build_owner_position_context,
    build_portfolio_review,
    compute_benchmark_comparison,
    derive_action,
    resolve_current_price,
    suggested_add_amount,
    suggested_reduce_amount,
    tax_lot_hint,
)
from stocvest.models.portfolio_holding import (
    HoldingLot,
    PortfolioHolding,
    PortfolioSettings,
)

pytestmark = pytest.mark.unit


class _Snap:
    def __init__(self, last_trade_price=None, day_close=None, prev_close=None):
        self.last_trade_price = last_trade_price
        self.day_close = day_close
        self.prev_close = prev_close


class _Bar:
    def __init__(self, ts, close):
        self.timestamp = ts
        self.close = close


class _Cand:
    def __init__(self, symbol, tier, verdict="bullish", why="cheap + strong"):
        self.symbol = symbol
        self.tier = tier
        self.verdict = verdict
        self.why = why


def _holding(symbol, lots):
    return PortfolioHolding(
        symbol=symbol,
        lots=tuple(
            HoldingLot(lot_id=f"{symbol}-{i}", quantity=q, cost_basis=c, purchase_date=d)
            for i, (q, c, d) in enumerate(lots)
        ),
    )


# ── resolve_current_price ────────────────────────────────────────────────────

def test_resolve_current_price_prefers_last_trade_then_falls_back():
    assert resolve_current_price(_Snap(last_trade_price=120.0, day_close=118.0)) == 120.0
    assert resolve_current_price(_Snap(day_close=118.0)) == 118.0
    assert resolve_current_price(_Snap(prev_close=115.0)) == 115.0
    assert resolve_current_price(_Snap()) is None
    assert resolve_current_price(None) is None


# ── derive_action (signal-first mapping) ─────────────────────────────────────

@pytest.mark.parametrize(
    "verdict,stance,status,expected",
    [
        ("bullish", "constructive", "ok", ReviewAction.BUY_MORE),
        ("bullish", "caution", "ok", ReviewAction.HOLD),
        ("bullish", None, "ok", ReviewAction.HOLD),
        ("neutral", "constructive", "ok", ReviewAction.HOLD),
        ("bearish", "defensive", "ok", ReviewAction.SELL),
        ("bearish", "caution", "ok", ReviewAction.TRIM),
        ("bearish", None, "ok", ReviewAction.TRIM),
        ("bullish", "constructive", "insufficient_data", ReviewAction.REVIEW),
        ("", None, "ok", ReviewAction.REVIEW),
    ],
)
def test_derive_action(verdict, stance, status, expected):
    assert derive_action(verdict=verdict, holder_stance=stance, status=status) == expected


# ── sizing helpers ───────────────────────────────────────────────────────────

def test_suggested_add_amount_gap_capped_by_cash():
    # target 60% of 2200 = 1320; position at 1200 → gap 120, cash 250 → 120
    assert suggested_add_amount(1200.0, 2200.0, 60.0, 250.0) == 120.0
    # gap larger than cash → capped by cash
    assert suggested_add_amount(1200.0, 2200.0, 60.0, 50.0) == 50.0
    # already over target → 0
    assert suggested_add_amount(1400.0, 2200.0, 50.0, 999.0) == 0.0
    # no target → None (directional only)
    assert suggested_add_amount(1200.0, 2200.0, None, 250.0) is None


def test_suggested_reduce_amount_only_when_overweight():
    # 1200 vs target 40% of 2200 = 880 → reduce 320
    assert suggested_reduce_amount(1200.0, 2200.0, 40.0) == 320.0
    # not overweight → None
    assert suggested_reduce_amount(500.0, 2200.0, 40.0) is None
    # no target → None
    assert suggested_reduce_amount(1200.0, 2200.0, None) is None


# ── tax-lot hint ─────────────────────────────────────────────────────────────

def test_tax_lot_hint_mixed_lots_on_sell():
    h = _holding("AAPL", [(5, 100, "2020-01-01"), (5, 150, "2026-06-01")])
    hint, lt, st = tax_lot_hint(h, ReviewAction.SELL, as_of=date(2026, 9, 11))
    assert lt == 1 and st == 1
    assert hint is not None and "long-term" in hint


def test_tax_lot_hint_absent_when_holding():
    h = _holding("AAPL", [(5, 100, "2020-01-01")])
    hint, lt, st = tax_lot_hint(h, ReviewAction.HOLD, as_of=date(2026, 9, 11))
    assert hint is None and lt == 1 and st == 0


# ── benchmark ────────────────────────────────────────────────────────────────

def test_spy_close_lookup_on_or_before():
    bars = [_Bar(date(2024, 1, 2), 470.0), _Bar(date(2024, 1, 5), 480.0)]
    lookup = _build_spy_close_lookup(bars)
    assert lookup(date(2024, 1, 3)) == 470.0  # weekend/holiday → prior close
    assert lookup(date(2024, 1, 5)) == 480.0
    assert lookup(date(2023, 1, 1)) == 470.0  # predates history → earliest close


def test_compute_benchmark_comparison_money_weighted():
    # $1000 invested when SPY=400 → 2.5 shares; SPY now 500 → $1250 → +25%
    result = compute_benchmark_comparison(
        lots=[(1000.0, "2024-01-02")],
        spy_close_on=lambda d: 400.0,
        spy_current=500.0,
        benchmark_symbol="SPY",
    )
    assert isinstance(result, BenchmarkComparison)
    assert result.benchmark_value == 1250.0
    assert result.benchmark_return_pct == 25.0


def test_compute_benchmark_comparison_unavailable_without_price():
    result = compute_benchmark_comparison(
        lots=[(1000.0, "2024-01-02")],
        spy_close_on=lambda d: None,
        spy_current=None,
        benchmark_symbol="SPY",
    )
    assert result.benchmark_value is None and result.benchmark_return_pct is None


# ── full orchestration (all providers injected) ──────────────────────────────

def test_build_portfolio_review_end_to_end():
    holdings = (
        _holding("AAPL", [(10, 100.0, "2020-01-01")]),   # long-term, bullish
        _holding("XOM", [(5, 200.0, "2026-06-01")]),     # short-term, bearish
    )
    settings = PortfolioSettings(cash_balance=250.0, target_position_pct=50.0, benchmark_symbol="SPY")

    prices = {
        "AAPL": _Snap(last_trade_price=120.0),
        "XOM": _Snap(last_trade_price=150.0),
        "SPY": _Snap(last_trade_price=500.0),
    }

    async def snap_fn(symbols):
        return {s: prices[s] for s in symbols if s in prices}

    bodies = {
        "AAPL": {"status": "ok", "signal_summary": "bullish"},  # → constructive stance
        "XOM": {
            "status": "ok",
            "signal_summary": "bearish",
            "signal_structure_broken": True,
            "risk_reward": 1.0,
            "min_rr_desk": 2.0,
        },  # → defensive stance
    }

    async def compose_fn(sym):
        return bodies[sym]

    async def spy_bars_fn(sym, from_date):
        return [_Bar(date(2020, 1, 2), 300.0), _Bar(date(2026, 6, 1), 480.0)]

    def scan_fn():
        return [_Cand("NVDA", "gem"), _Cand("AAPL", "gem"), _Cand("KO", "monitor")]

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=scan_fn,
            as_of=date(2026, 9, 11),
        )
    )

    by_sym = {h.symbol: h for h in review.holdings}

    # AAPL: mkt 1200 / total 2200 = 54.5% > 50% target → overweight; bullish+constructive
    # would be BUY_MORE but it's over target so add=0 → downgraded to HOLD.
    aapl = by_sym["AAPL"]
    assert aapl.action == ReviewAction.HOLD
    assert aapl.overweight is True
    assert aapl.unrealized_pl == 200.0  # (120-100)*10

    # XOM: bearish + defensive → SELL; short-term single lot tax hint.
    xom = by_sym["XOM"]
    assert xom.action == ReviewAction.SELL
    assert xom.short_term_lots == 1 and xom.long_term_lots == 0
    assert xom.tax_lot_hint is not None

    # Concentration flags AAPL only.
    assert [c.symbol for c in review.concentration] == ["AAPL"]

    # Consider-adding: gem tier, excludes already-held AAPL, drops monitor KO.
    assert [c.symbol for c in review.consider_adding] == ["NVDA"]

    # Benchmark present and computed.
    assert review.benchmark is not None
    assert review.benchmark.benchmark_return_pct is not None

    # to_api round-trips without raising.
    payload = review.to_api()
    assert payload["holdings"][0]["action"] in {"hold", "sell", "buy_more", "trim", "review"}
    assert payload["disclaimer"]


def test_owner_context_priced_bullish():
    h = _holding("AAPL", [(10, 100.0, "2020-01-01")])
    body = {"status": "ok", "signal_summary": "bullish"}  # → constructive stance
    ctx = build_owner_position_context(
        body=body, holding=h, current_price=120.0, as_of=date(2026, 9, 11)
    )
    assert ctx["symbol"] == "AAPL"
    assert ctx["action"] == ReviewAction.BUY_MORE.value
    assert ctx["unrealized_pl"] == 200.0
    assert ctx["unrealized_pl_pct"] == 20.0
    assert ctx["long_term_lots"] == 1 and ctx["short_term_lots"] == 0
    assert ctx["earliest_purchase_date"] == "2020-01-01"


def test_owner_context_unpriced_has_null_pl():
    h = _holding("XOM", [(5, 200.0, "2026-06-01")])
    body = {
        "status": "ok",
        "signal_summary": "bearish",
        "signal_structure_broken": True,
        "risk_reward": 1.0,
        "min_rr_desk": 2.0,
    }
    ctx = build_owner_position_context(
        body=body, holding=h, current_price=None, as_of=date(2026, 9, 11)
    )
    assert ctx["action"] == ReviewAction.SELL.value
    assert ctx["unrealized_pl"] is None and ctx["unrealized_pl_pct"] is None
    assert ctx["market_value"] == 1000.0  # valued at cost when unpriced
    assert ctx["tax_lot_hint"] is not None  # short-term sell hint


def test_build_portfolio_review_empty_portfolio():
    review = asyncio.run(
        build_portfolio_review(
            holdings=(),
            settings=PortfolioSettings(cash_balance=1000.0),
        )
    )
    assert review.holdings == []
    assert review.total_market_value == 1000.0
    assert review.cash_balance == 1000.0


def test_build_portfolio_review_advice_disabled_is_informational_only():
    """With personal-advice mode OFF, actions degrade to REVIEW and advisory extras drop."""
    holdings = (
        _holding("AAPL", [(10, 100.0, "2020-01-01")]),
        _holding("XOM", [(5, 200.0, "2026-06-01")]),
    )
    settings = PortfolioSettings(cash_balance=250.0, target_position_pct=50.0, benchmark_symbol="SPY")
    prices = {
        "AAPL": _Snap(last_trade_price=120.0),
        "XOM": _Snap(last_trade_price=150.0),
        "SPY": _Snap(last_trade_price=500.0),
    }

    async def snap_fn(symbols):
        return {s: prices[s] for s in symbols if s in prices}

    async def compose_fn(sym):
        return {"status": "ok", "signal_summary": "bullish"}

    async def spy_bars_fn(sym, from_date):
        return [_Bar(date(2020, 1, 2), 300.0), _Bar(date(2026, 6, 1), 480.0)]

    def scan_fn():
        return [_Cand("NVDA", "gem")]

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=scan_fn,
            as_of=date(2026, 9, 11),
            advice_enabled=False,
        )
    )

    # Every action is the informational REVIEW; no sizing / holder-read / concentration / adds.
    assert all(h.action == ReviewAction.REVIEW for h in review.holdings)
    assert all(h.suggested_add_amount is None and h.suggested_reduce_amount is None for h in review.holdings)
    assert all(h.holder_read is None for h in review.holdings)
    assert review.concentration == []
    assert review.consider_adding == []
    # Factual valuation is still present.
    assert review.holdings[0].unrealized_pl == 200.0
    assert review.benchmark is not None


def test_build_portfolio_review_buy_more_capped_by_aggregate_cash():
    """Two BUY_MORE candidates cannot jointly exceed available cash."""
    holdings = (
        _holding("AAA", [(1, 10.0, "2020-01-01")]),
        _holding("BBB", [(1, 10.0, "2020-01-01")]),
    )
    # Tiny weights vs a high target → each has a large gap, but only $30 cash total.
    settings = PortfolioSettings(cash_balance=30.0, target_position_pct=90.0, benchmark_symbol="SPY")
    prices = {"AAA": _Snap(last_trade_price=100.0), "BBB": _Snap(last_trade_price=100.0)}

    async def snap_fn(symbols):
        return {s: prices[s] for s in symbols if s in prices}

    async def compose_fn(sym):
        return {"status": "ok", "signal_summary": "bullish"}  # → BUY_MORE

    async def spy_bars_fn(sym, from_date):
        return []

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 11),
            advice_enabled=True,
        )
    )
    total_add = sum(h.suggested_add_amount or 0.0 for h in review.holdings)
    assert total_add <= 30.0 + 1e-6

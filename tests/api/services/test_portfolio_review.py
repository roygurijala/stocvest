"""Unit tests for the portfolio review engine (offline; all data injected)."""

from __future__ import annotations

import asyncio
from datetime import date

import pytest

from stocvest.api.services.portfolio_review import (
    BenchmarkComparison,
    ReviewAction,
    _SIZING_RULE,
    _build_spy_close_lookup,
    apply_stance_sizing,
    build_owner_position_context,
    build_portfolio_review,
    compute_benchmark_comparison,
    derive_action,
    resolve_current_price,
    resolve_effective_target_pct,
    sizing_reason,
    suggested_add_amount,
    suggested_reduce_amount,
    tax_lot_hint,
    unfilled_gap_dollars,
)
from stocvest.api.services.portfolio_sleeve_policy import (
    PositionSleeve,
    sleeve_policy_for,
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


def test_resolve_effective_target_explicit_wins_over_default():
    pct, used_default = resolve_effective_target_pct(
        explicit_target_pct=5.0, holding_count=11, advice_enabled=True
    )
    assert pct == 5.0 and used_default is False


def test_resolve_effective_target_personal_default_is_sleeve_mode():
    pct, used_default = resolve_effective_target_pct(
        explicit_target_pct=None, holding_count=11, advice_enabled=True
    )
    assert pct is None and used_default is True


def test_resolve_effective_target_product_mode_null_is_none():
    pct, used_default = resolve_effective_target_pct(
        explicit_target_pct=None, holding_count=11, advice_enabled=False
    )
    assert pct is None and used_default is False


def test_apply_stance_sizing_buy_more_fills_gap():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.BUY_MORE,
        overweight=False,
        add_gap=250.0,
        reduce_excess=None,
        market_value=800.0,
    )
    assert action == ReviewAction.BUY_MORE
    assert add_amt == 250.0 and reduce_amt is None and note is None


def test_apply_stance_sizing_hold_over_target_trims_excess_only():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.HOLD,
        overweight=True,
        add_gap=0.0,
        reduce_excess=180.0,
        market_value=1180.0,
    )
    assert action == ReviewAction.HOLD
    assert add_amt is None and reduce_amt == 180.0 and note is None


def test_apply_stance_sizing_hold_under_target_does_not_add():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.HOLD,
        overweight=False,
        add_gap=400.0,
        reduce_excess=None,
        market_value=600.0,
    )
    assert action == ReviewAction.HOLD
    assert add_amt is None and reduce_amt is None


def test_apply_stance_sizing_trim_is_excess_not_to_zero():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.TRIM,
        overweight=True,
        add_gap=0.0,
        reduce_excess=220.0,
        market_value=1220.0,
    )
    assert action == ReviewAction.TRIM
    assert add_amt is None and reduce_amt == 220.0
    assert reduce_amt != 1220.0


def test_apply_stance_sizing_sell_is_full_market_value():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.SELL,
        overweight=False,
        add_gap=None,
        reduce_excess=None,
        market_value=750.0,
    )
    assert action == ReviewAction.SELL
    assert add_amt is None and reduce_amt == 750.0


def test_apply_stance_sizing_review_emits_no_amounts():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.REVIEW,
        overweight=False,
        add_gap=400.0,
        reduce_excess=180.0,
        market_value=600.0,
    )
    assert action == ReviewAction.REVIEW
    assert add_amt is None and reduce_amt is None and note is None


def test_apply_stance_sizing_buy_more_no_cash_says_no_cash():
    action, add_amt, reduce_amt, note = apply_stance_sizing(
        action=ReviewAction.BUY_MORE,
        overweight=False,
        add_gap=0.0,
        reduce_excess=None,
        market_value=600.0,
        cash_available=0.0,
    )
    assert action == ReviewAction.HOLD
    assert add_amt is None and reduce_amt is None
    assert note is not None and "no cash" in note.lower()
    assert "already at/over target" not in note.lower()


def test_sizing_reason_sell_under_target():
    reason = sizing_reason(
        action=ReviewAction.SELL,
        target_pct=9.0909,
        weight_pct=4.2,
        suggested_add=None,
        suggested_reduce=7100.0,
        portfolio_value=168000.0,
        stance="defensive",
    )
    assert reason == (
        "Sell overrides the target: reducing the full position even though "
        "weight is below the ~9.1% target."
    )


def test_sizing_reason_hold_caution_under_target_names_unfilled_gap():
    reason = sizing_reason(
        action=ReviewAction.HOLD,
        target_pct=9.1,
        weight_pct=5.0,
        suggested_add=None,
        suggested_reduce=None,
        portfolio_value=168000.0,
        stance="caution",
    )
    gap = unfilled_gap_dollars(target_pct=9.1, weight_pct=5.0, portfolio_value=168000.0)
    assert gap == round((9.1 - 5.0) / 100.0 * 168000.0, 2)
    assert reason == (
        "Hold + caution: not adding toward the ~9.1% target (thin R/R). "
        f"Gap to target would be ~${gap:,.2f}."
    )


def test_sizing_reason_hold_over_target_trims_excess():
    reason = sizing_reason(
        action=ReviewAction.HOLD,
        target_pct=9.1,
        weight_pct=14.0,
        suggested_add=None,
        suggested_reduce=8200.0,
        portfolio_value=168000.0,
        stance="caution",
    )
    assert reason == "Over the ~9.1% target — trimming the excess only."


def test_sizing_reason_buy_more_adds_gap():
    reason = sizing_reason(
        action=ReviewAction.BUY_MORE,
        target_pct=9.1,
        weight_pct=5.0,
        suggested_add=400.0,
        suggested_reduce=None,
        portfolio_value=168000.0,
        stance="constructive",
    )
    assert reason == "Under the ~9.1% target — adding the gap (cash-capped)."


def test_sizing_reason_at_target_or_no_change():
    at_target = sizing_reason(
        action=ReviewAction.HOLD,
        target_pct=9.1,
        weight_pct=9.1,
        suggested_add=None,
        suggested_reduce=None,
        portfolio_value=168000.0,
        stance="constructive",
    )
    assert at_target == "At the ~9.1% target"
    no_change = sizing_reason(
        action=ReviewAction.REVIEW,
        target_pct=None,
        weight_pct=5.0,
        suggested_add=None,
        suggested_reduce=None,
        portfolio_value=168000.0,
    )
    assert no_change == "No size change."


def test_sizing_reason_in_band_core_sleeve():
    reason = sizing_reason(
        action=ReviewAction.HOLD,
        target_pct=12.0,
        weight_pct=11.0,
        suggested_add=None,
        suggested_reduce=None,
        portfolio_value=168000.0,
        stance="constructive",
        sleeve=sleeve_policy_for(PositionSleeve.CORE),
    )
    assert reason == "Inside the core 10–12% sleeve."


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
    # would be BUY_MORE but it's over target so add=0 → downgraded to HOLD and trim excess.
    aapl = by_sym["AAPL"]
    assert aapl.action == ReviewAction.HOLD
    assert aapl.overweight is True
    assert aapl.unrealized_pl == 200.0  # (120-100)*10
    assert aapl.suggested_add_amount is None
    assert aapl.suggested_reduce_amount == 100.0  # 1200 − 50% of 2200

    # XOM: bearish + defensive → SELL; full market value, not excess-to-target.
    xom = by_sym["XOM"]
    assert xom.action == ReviewAction.SELL
    assert xom.short_term_lots == 1 and xom.long_term_lots == 0
    assert xom.tax_lot_hint is not None
    assert xom.suggested_reduce_amount == 750.0

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
    assert payload["sizingRule"] == _SIZING_RULE
    assert "sizingReason" in payload["holdings"][0]


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
            advice_enabled=True,
        )
    )
    assert review.holdings == []
    assert review.total_market_value == 1000.0
    assert review.cash_balance == 1000.0
    # Empty book: sleeve policy is named; no single equal-weight pct.
    assert review.effective_target_pct is None
    assert review.target_is_default is True
    assert review.sizing_policy == "sleeve"


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


def test_fund_vehicle_rationale_does_not_ask_for_filings():
    holdings = (_holding("ARKQ", [(20, 50.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=100.0)

    async def snap_fn(symbols):
        return {s: _Snap(last_trade_price=60.0) for s in symbols}

    async def compose_fn(sym):
        return {
            "status": "ok",
            "signal_summary": "neutral",
            "is_fund_vehicle": True,
            "instrument_type": "ETF",
        }

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
            as_of=date(2026, 9, 12),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.symbol == "ARKQ"
    assert row.is_fund_vehicle is True
    joined = " ".join(row.rationale).lower()
    assert "fund/etf vehicle" in joined
    assert "10-k" in joined
    assert "verify against filings" not in joined
    assert row.to_api()["isFundVehicle"] is True


def test_rationale_labels_cost_window_vs_six_month_rs():
    holdings = (_holding("ECHO", [(10, 114.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=100.0)

    async def snap_fn(symbols):
        return {s: _Snap(last_trade_price=91.0) for s in symbols}

    async def compose_fn(sym):
        return {
            "status": "ok",
            "signal_summary": "neutral",
            "layers": [
                {
                    "layer": "technical",
                    "indicator_snapshot": {"rs_vs_spy_6m_pct": 177.2},
                }
            ],
        }

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
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    joined = " ".join(review.holdings[0].rationale)
    assert "vs your cost basis" in joined
    assert "different window than 6-month RS vs SPY" in joined
    assert "+177.2%" in joined
    assert "not vs your cost" in joined
    assert review.holdings[0].unrealized_pl_pct is not None
    assert review.holdings[0].unrealized_pl_pct < 0


def _prices_and_compose(bodies: dict, prices: dict):
    async def snap_fn(symbols):
        return {s: prices[s] for s in symbols if s in prices}

    async def compose_fn(sym):
        return bodies[sym]

    async def spy_bars_fn(sym, from_date):
        return []

    return snap_fn, compose_fn, spy_bars_fn


def test_personal_default_uses_standard_sleeve_not_equal_weight():
    """11 equal neutral names → standard 6–9% sleeve, not 100/11 ≈ 9.09%."""
    holdings = tuple(_holding(f"N{i:02d}", [(1, 10.0, "2024-01-02")]) for i in range(11))
    settings = PortfolioSettings(cash_balance=0.0)  # null target
    prices = {h.symbol: _Snap(last_trade_price=100.0) for h in holdings}
    prices["SPY"] = _Snap(last_trade_price=500.0)
    bodies = {h.symbol: {"status": "ok", "signal_summary": "neutral"} for h in holdings}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    assert review.effective_target_pct is None
    assert review.target_is_default is True
    assert review.sizing_policy == "sleeve"
    assert settings.target_position_pct is None  # never persisted
    assert all(h.sleeve == "standard" for h in review.holdings)
    assert all(h.sleeve_low_pct == 6.0 and h.sleeve_high_pct == 9.0 for h in review.holdings)
    assert all(h.effective_target_pct == 9.0 for h in review.holdings)
    payload = review.to_api()
    assert payload["sizingPolicy"] == "sleeve"
    assert payload["targetIsDefault"] is True
    # ~9.09% sits just over the 9% standard high → trim the excess, not back to 9.09.
    row = review.holdings[0]
    assert row.weight_pct == pytest.approx(100.0 / 11, abs=0.02)
    assert row.overweight is True
    assert row.suggested_reduce_amount is not None and row.suggested_reduce_amount > 0


def test_core_sleeve_trims_to_twelve_not_equal_weight():
    """A lone bullish/constructive name at 100% trims to the 12% core high, not 12.5%."""
    holdings = (_holding("NVDA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=0.0)
    prices = {"NVDA": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {"NVDA": {"status": "ok", "signal_summary": "bullish"}}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.sleeve == "core"
    assert row.sleeve_low_pct == 10.0 and row.sleeve_high_pct == 12.0
    assert row.weight_pct == 100.0
    assert row.overweight is True
    assert row.suggested_reduce_amount == pytest.approx(88.0, abs=0.02)
    assert "core" in (row.sizing_reason or "")


def test_vehicle_sleeve_trims_to_six():
    holdings = (_holding("IBIT", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=0.0)
    prices = {"IBIT": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {
        "IBIT": {
            "status": "ok",
            "signal_summary": "neutral",
            "is_fund_vehicle": True,
        }
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.sleeve == "vehicle"
    assert row.sleeve_high_pct == 6.0
    assert row.suggested_reduce_amount == pytest.approx(94.0, abs=0.02)


def test_structure_broken_exit_sleeve_trims_to_three():
    holdings = (_holding("SOFI", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=0.0)
    prices = {"SOFI": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {
        "SOFI": {
            "status": "ok",
            "signal_summary": "neutral",
            "signal_structure_broken": True,
        }
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.sleeve == "exit"
    assert row.sleeve_high_pct == 3.0
    assert row.action == ReviewAction.HOLD
    assert row.suggested_reduce_amount == pytest.approx(97.0, abs=0.02)


def test_in_band_core_does_not_trim():
    """Core at 11% (inside 10–12) is not overweight — winners may sit in the band."""
    holdings = (
        _holding("NVDA", [(11, 10.0, "2024-01-02")]),
        _holding("CASHY", [(89, 10.0, "2024-01-02")]),
    )
    settings = PortfolioSettings(cash_balance=0.0)
    prices = {
        "NVDA": _Snap(last_trade_price=10.0),
        "CASHY": _Snap(last_trade_price=10.0),
        "SPY": _Snap(last_trade_price=500.0),
    }
    bodies = {
        "NVDA": {"status": "ok", "signal_summary": "bullish"},
        "CASHY": {"status": "ok", "signal_summary": "neutral"},
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)
    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    nvda = next(h for h in review.holdings if h.symbol == "NVDA")
    assert nvda.sleeve == "core"
    assert nvda.weight_pct == 11.0
    assert nvda.overweight is False
    assert nvda.suggested_add_amount is None
    assert nvda.suggested_reduce_amount is None
    assert "Inside the core" in (nvda.sizing_reason or "")


def test_explicit_target_wins_over_personal_default():
    holdings = (_holding("AAA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=100.0, target_position_pct=20.0)
    prices = {"AAA": _Snap(last_trade_price=80.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {"AAA": {"status": "ok", "signal_summary": "bullish"}}  # BUY_MORE
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    assert review.effective_target_pct == 20.0
    assert review.target_is_default is False
    assert review.sizing_policy == "explicit"
    # 80 / 180 ≈ 44.4% > 20% → overweight; BUY_MORE downgrades to HOLD + trim excess
    row = review.holdings[0]
    assert row.overweight is True
    assert row.suggested_add_amount is None
    assert row.suggested_reduce_amount == pytest.approx(80.0 - 0.20 * 180.0, abs=0.02)


def test_product_mode_null_target_emits_no_amounts():
    holdings = (_holding("AAA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=500.0)  # null target
    prices = {"AAA": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {"AAA": {"status": "ok", "signal_summary": "bullish"}}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=False,
        )
    )
    assert review.effective_target_pct is None
    assert review.target_is_default is False
    assert review.holdings[0].suggested_add_amount is None
    assert review.holdings[0].suggested_reduce_amount is None


def test_hold_caution_under_target_does_not_add():
    """Bullish + thin R/R → HOLD / caution; underweight still does not add (avoid-adding)."""
    holdings = (_holding("AAA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=900.0, target_position_pct=50.0)
    prices = {"AAA": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {
        "AAA": {
            "status": "ok",
            "signal_summary": "bullish",
            "risk_reward": 1.0,
            "min_rr_desk": 2.0,
        }
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.action == ReviewAction.HOLD
    assert row.holder_read is not None
    assert row.holder_read["stance"] == "caution"
    assert row.overweight is False
    assert row.suggested_add_amount is None
    assert row.suggested_reduce_amount is None
    assert row.weight_pct is not None and row.effective_target_pct is not None
    gap = unfilled_gap_dollars(
        target_pct=row.effective_target_pct,
        weight_pct=row.weight_pct,
        portfolio_value=review.total_market_value,
    )
    assert gap is not None and gap > 0
    assert row.sizing_reason == (
        f"Hold + caution: not adding toward the ~{row.effective_target_pct:.1f}% "
        f"target (thin R/R). Gap to target would be ~${gap:,.2f}."
    )
    payload = review.to_api()
    assert payload["holdings"][0]["sizingReason"] == row.sizing_reason
    assert payload["holdings"][0]["suggestedAddAmount"] is None


def test_sell_under_target_reduces_full_market_value():
    """Bearish + defensive → SELL; reduce full MV even when weight is below target."""
    holdings = (_holding("ARKQ", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=900.0, target_position_pct=50.0)
    prices = {"ARKQ": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {
        "ARKQ": {
            "status": "ok",
            "signal_summary": "bearish",
            "signal_structure_broken": True,
            "risk_reward": 1.0,
            "min_rr_desk": 2.0,
        }
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.action == ReviewAction.SELL
    assert row.overweight is False
    assert row.suggested_add_amount is None
    assert row.suggested_reduce_amount == 100.0  # full MV, not the underweight gap
    assert row.weight_pct is not None and row.effective_target_pct is not None
    assert row.weight_pct < row.effective_target_pct
    assert row.sizing_reason == (
        "Sell overrides the target: reducing the full position even though "
        f"weight is below the ~{row.effective_target_pct:.1f}% target."
    )
    payload = review.to_api()
    assert payload["holdings"][0]["sizingReason"] == row.sizing_reason
    assert payload["holdings"][0]["suggestedReduceAmount"] == 100.0


def test_vehicle_overweight_uses_same_gap_not_f1f5():
    holdings = (_holding("XOVR", [(10, 20.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=100.0, target_position_pct=10.0)
    prices = {"XOVR": _Snap(last_trade_price=40.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {
        "XOVR": {
            "status": "ok",
            "signal_summary": "bearish",
            "is_fund_vehicle": True,
            "instrument_type": "ETF",
        }
    }
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.is_fund_vehicle is True
    assert row.action == ReviewAction.TRIM
    # MV 400, total 500, target 10% = 50 → excess 350. Not a 50% trim and not "to 2%".
    assert row.suggested_reduce_amount == 350.0
    assert row.suggested_reduce_amount != 400.0
    joined = " ".join(row.rationale).lower()
    assert "above your 10.0% target" in joined
    assert "f1" not in joined or "do not apply" in joined
    assert review.concentration[0].target_pct == 10.0
    assert "10.0% target" in review.concentration[0].message


def test_ai_read_payload_forwards_suggested_amounts():
    holdings = (_holding("AAA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=500.0, target_position_pct=80.0)
    prices = {"AAA": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {"AAA": {"status": "ok", "signal_summary": "bullish"}}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)
    captured: dict = {}

    async def ai_fn(symbol, payload):
        captured["symbol"] = symbol
        captured["payload"] = payload
        return "ok"

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            ai_read_fn=ai_fn,
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.action == ReviewAction.BUY_MORE
    assert row.suggested_add_amount is not None and row.suggested_add_amount > 0
    assert captured["payload"]["suggested_add_amount"] == row.suggested_add_amount
    assert captured["payload"]["review_action"] == "buy_more"


def test_unpriced_holding_null_pl_and_cost_basis_label():
    holdings = (_holding("AAA", [(10, 50.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=100.0, target_position_pct=20.0)
    prices = {"SPY": _Snap(last_trade_price=500.0)}  # AAA missing → unpriced
    bodies = {"AAA": {"status": "ok", "signal_summary": "bullish"}}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.current_price is None
    assert row.unrealized_pl is None and row.unrealized_pl_pct is None
    assert row.market_value == 500.0  # 10 × cost 50 — existing cost fallback
    assert review.fully_priced is False
    joined = " ".join(row.rationale).lower()
    assert "live price unavailable" in joined
    assert "cost basis" in joined


def test_review_action_emits_no_amounts_even_with_default_target():
    holdings = (_holding("AAA", [(1, 10.0, "2024-01-02")]),)
    settings = PortfolioSettings(cash_balance=500.0)  # null target → personal default
    prices = {"AAA": _Snap(last_trade_price=100.0), "SPY": _Snap(last_trade_price=500.0)}
    bodies = {"AAA": {"status": "insufficient_data", "signal_summary": "bullish"}}
    snap_fn, compose_fn, spy_bars_fn = _prices_and_compose(bodies, prices)

    review = asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            compose_fn=compose_fn,
            snapshot_fn=snap_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=lambda: [],
            as_of=date(2026, 9, 13),
            advice_enabled=True,
        )
    )
    row = review.holdings[0]
    assert row.action == ReviewAction.REVIEW
    assert row.suggested_add_amount is None
    assert row.suggested_reduce_amount is None
    assert review.effective_target_pct is None
    assert review.target_is_default is True
    assert review.sizing_policy == "sleeve"

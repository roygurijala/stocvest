"""Universe eligibility gates — market cap, ADR watchlist, splits, suspension."""

from __future__ import annotations

from datetime import date, timedelta

from stocvest.data.models import Snapshot
from stocvest.data.symbol_universe_eligibility import (
    UniverseEligibilityContext,
    snapshot_universe_exclusion_reason,
    universe_exclusion_reason,
)
from stocvest.data.ticker_reference import TickerReference


def _snap(
    symbol: str,
    *,
    last: float = 10.0,
    prev: float = 9.5,
    day_vol: float = 2_000_000.0,
    prev_vol: float = 2_000_000.0,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        last_trade_price=last,
        prev_close=prev,
        day_volume=day_vol,
        prev_day_volume=prev_vol,
    )


def test_chinese_adr_watchlist_blocks_ccm() -> None:
    reason = snapshot_universe_exclusion_reason("CCM", _snap("CCM"))
    assert reason is not None
    assert "watch" in reason.lower()


def test_sub_dollar_price_blocked() -> None:
    snap = _snap("PENNY", last=0.85, prev=0.90)
    assert snapshot_universe_exclusion_reason("PENNY", snap) == "price below $1 minimum"


def test_frequent_reverse_split_blocked() -> None:
    snap = _snap("SPLITCO")
    reason = snapshot_universe_exclusion_reason(
        "SPLITCO",
        snap,
        frequent_reverse_split_symbols=frozenset({"SPLITCO"}),
    )
    assert reason == "multiple reverse splits in the last year"


def test_market_cap_passes_with_reference() -> None:
    ref = TickerReference(
        symbol="BIG",
        active=True,
        market_cap=2_000_000_000.0,
        security_type="CS",
        locale="us",
        country_code="US",
        primary_exchange="XNAS",
        list_date=date.today() - timedelta(days=400),
        name="Big Co",
    )
    snap = _snap("BIG", prev_vol=100_000.0)
    reason = universe_exclusion_reason(
        "BIG",
        UniverseEligibilityContext(snapshot=snap, reference=ref),
        mode="swing",
    )
    assert reason is None


def test_inactive_ticker_blocked() -> None:
    ref = TickerReference(
        symbol="DEAD",
        active=False,
        market_cap=5_000_000_000.0,
        security_type="CS",
        locale="us",
        country_code="US",
        primary_exchange="XNAS",
        list_date=date.today() - timedelta(days=400),
        name="Dead Co",
    )
    snap = _snap("DEAD")
    reason = universe_exclusion_reason(
        "DEAD",
        UniverseEligibilityContext(snapshot=snap, reference=ref),
        mode="swing",
    )
    assert reason is not None
    assert "not active" in reason.lower()


def test_recent_listing_blocked() -> None:
    ref = TickerReference(
        symbol="IPO",
        active=True,
        market_cap=5_000_000_000.0,
        security_type="CS",
        locale="us",
        country_code="US",
        primary_exchange="XNAS",
        list_date=date.today() - timedelta(days=30),
        name="New IPO",
    )
    snap = _snap("IPO")
    reason = universe_exclusion_reason(
        "IPO",
        UniverseEligibilityContext(snapshot=snap, reference=ref),
        mode="swing",
    )
    assert reason is not None
    assert "90 days" in reason


def test_known_ipo_ticker_blocked_without_reference() -> None:
    snap = _snap("SPCX")
    reason = universe_exclusion_reason(
        "SPCX",
        UniverseEligibilityContext(snapshot=snap, reference=None),
        mode="day",
    )
    assert reason is not None
    assert "unverified" in reason.lower() or "90 days" in reason


def test_micro_cap_chinese_adr_blocked_by_reference() -> None:
    ref = TickerReference(
        symbol="ADR1",
        active=True,
        market_cap=50_000_000.0,
        security_type="ADRC",
        locale="global",
        country_code="CN",
        primary_exchange="XNAS",
        list_date=date.today() - timedelta(days=400),
        name="China ADR",
    )
    snap = _snap("ADR1")
    reason = universe_exclusion_reason(
        "ADR1",
        UniverseEligibilityContext(snapshot=snap, reference=ref),
        mode="swing",
    )
    assert reason is not None
    assert "ADR" in reason or "market cap" in reason.lower()

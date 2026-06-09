"""IPO ecosystem registry, listing-age gates, and gap market-context adjustments."""

from __future__ import annotations

from datetime import date, timedelta

from stocvest.data.ipo_ecosystem_registry import (
    ANTHROPIC_ECOSYSTEM,
    OPENAI_ECOSYSTEM,
    SPACEX_ECOSYSTEM,
    get_ecosystem,
    get_ecosystems_for_symbol,
    known_recent_ipo_tickers,
)
from stocvest.data.market_context_flags import resolve_market_context_flags
from stocvest.data.symbol_universe_eligibility import (
    MIN_LISTED_DAYS,
    listing_age_exclusion_reason,
    resolve_listed_days,
)
from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.gap_intelligence import (
    calculate_gap_quality_score,
    enrich_gap_items_with_market_context,
)


def test_spacex_ecosystem_includes_etf_and_corporate_backers() -> None:
    peers = set(SPACEX_ECOSYSTEM.all_tradable_peers())
    assert "GOOGL" in peers
    assert "XOVR" in peers
    assert "NASA" in peers
    assert "DXYZ" in peers
    assert "SATS" in peers
    assert "RKLB" in peers


def test_anthropic_and_openai_ecosystems_include_msft_nvda_amzn() -> None:
    assert "MSFT" in ANTHROPIC_ECOSYSTEM.corporate_backers
    assert "MSFT" in OPENAI_ECOSYSTEM.corporate_backers
    assert "NVDA" in OPENAI_ECOSYSTEM.corporate_backers
    assert "AMZN" in OPENAI_ECOSYSTEM.corporate_backers
    assert "GOOGL" not in OPENAI_ECOSYSTEM.corporate_backers


def test_googl_maps_to_multiple_ecosystems() -> None:
    entities = {e.trigger_entity for e in get_ecosystems_for_symbol("GOOGL")}
    assert entities == {"SpaceX", "Anthropic"}


def test_known_recent_ipo_ticker_includes_spcx() -> None:
    assert "SPCX" in known_recent_ipo_tickers()


def test_listing_age_blocks_recent_ipo_with_reference() -> None:
    ref = TickerReference(
        symbol="IPO",
        active=True,
        market_cap=5_000_000_000.0,
        security_type="CS",
        locale="us",
        country_code="US",
        primary_exchange="XNAS",
        list_date=date.today() - timedelta(days=20),
        name="New IPO",
    )
    assert listing_age_exclusion_reason("IPO", ref) is not None


def test_spcx_fail_closed_without_reference() -> None:
    reason = listing_age_exclusion_reason("SPCX", None, as_of=date(2026, 6, 20))
    assert reason is not None
    assert str(MIN_LISTED_DAYS) in reason


def test_resolve_listed_days_uses_ipo_calendar_for_spcx() -> None:
    days = resolve_listed_days("SPCX", None, as_of=date(2026, 6, 20))
    assert days == 8


def test_market_context_flags_index_window_for_spcx() -> None:
    flags = resolve_market_context_flags("SPCX", reference=None, as_of=date(2026, 6, 20))
    assert flags["ipo_unseasoned"] is True
    assert flags["index_inclusion_window"] is True
    assert flags["warnings"]


def test_gap_volume_capped_for_mechanical_flow() -> None:
    full = calculate_gap_quality_score(8.0, 3.0, False, 120.0)
    capped = calculate_gap_quality_score(8.0, 3.0, False, 120.0, cap_volume_for_mechanical_flow=True)
    assert capped < full


def test_enrich_gap_items_excludes_unseasoned_listed_issuer() -> None:
    items = [
        {
            "symbol": "SPCX",
            "gap_pct": 12.0,
            "volume_vs_avg": 4.0,
            "has_catalyst": False,
            "current_price": 140.0,
            "gap_quality_score": 80,
        }
    ]
    out = enrich_gap_items_with_market_context(items, references_by_symbol={"SPCX": None})
    assert out == []

def test_get_ecosystem_by_entity() -> None:
    assert get_ecosystem("anthropic") is ANTHROPIC_ECOSYSTEM

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from stocvest.api.services.gap_intelligence_news import collect_news_for_gap_intelligence
from stocvest.data.models import NewsArticle, Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.gap_intelligence import (
    MODE_BEST_FIT_VALUES,
    _catalyst_lookback_hours_at,
    build_gap_intelligence_items,
    classify_mode_best_fit,
)
from stocvest.signals.news_catalyst_detector import NewsCatalystDetector


def _snap(symbol: str, prev_close: float, price: float, vol: float, adv: float, name: str = "") -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        last_trade_price=price,
        day_volume=vol,
        prev_day_volume=adv,
        company_name=name or None,
    )


def _art(
    aid: str,
    title: str,
    *,
    tickers: list[str],
    hours_ago: int = 1,
) -> NewsArticle:
    return NewsArticle(
        article_id=aid,
        published_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=tickers,
        keywords=[],
    )


def test_lookback_48h_saturday_afternoon_et() -> None:
    ny = datetime(2026, 5, 2, 14, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


def test_lookback_24h_tuesday_mid_session_et() -> None:
    ny = datetime(2026, 5, 5, 10, 30, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 24


def test_lookback_48h_weekday_premarket_et() -> None:
    ny = datetime(2026, 5, 4, 9, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


def test_lookback_48h_weekday_after_close_et() -> None:
    ny = datetime(2026, 5, 4, 20, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


@pytest.mark.asyncio
async def test_deduplication_removes_duplicate_articles() -> None:
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)
    shared = NewsArticle(
        article_id="same-id",
        published_at=ts,
        title="Shared headline",
        description="",
        url="https://example.com/a",
        source="Reuters",
        tickers=["AAA"],
        keywords=[],
    )

    class FakeClient:
        async def get_news(self, symbol=None, limit: int = 50):
            _ = limit
            if symbol is None:
                return [shared]
            return [shared]

    out = await collect_news_for_gap_intelligence(FakeClient(), ["AAA"], global_limit=50, per_symbol_limit=5)
    assert len(out) == 1
    assert out[0].article_id == "same-id"


@pytest.mark.asyncio
async def test_per_symbol_news_fetched_for_gap_candidates() -> None:
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)

    class FakeClient:
        calls: list[tuple[str | None, int]] = []

        async def get_news(self, symbol=None, limit: int = 50):
            self.calls.append((symbol, limit))
            if symbol is None:
                return [
                    NewsArticle(
                        article_id="g1",
                        published_at=ts,
                        title="Market wrap",
                        description="",
                        url="https://example.com/g1",
                        source="Reuters",
                        tickers=["SPY"],
                        keywords=[],
                    )
                ]
            return [
                NewsArticle(
                    article_id=f"x-{symbol}",
                    published_at=ts,
                    title=f"{symbol} upgraded by analysts",
                    description="",
                    url=f"https://example.com/{symbol}",
                    source="Reuters",
                    tickers=[symbol],
                    keywords=[],
                )
            ]

    fc = FakeClient()
    await collect_news_for_gap_intelligence(fc, ["ZZZ", "YYY"], global_limit=40, per_symbol_limit=3, max_symbols=10)
    syms = [c[0] for c in fc.calls]
    assert None in syms
    assert "ZZZ" in syms and "YYY" in syms


def test_company_name_fallback_matches_article() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="GME",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        )
    ]
    snaps = {"GME": _snap("GME", prev_close=100, price=110, vol=900_000, adv=400_000, name="GameStop Corporation")}
    arts = [
        NewsArticle(
            article_id="gme-n",
            published_at=datetime.now(timezone.utc),
            title="GameStop shares surge after analyst upgrade",
            description="",
            url="https://example.com",
            source="Reuters",
            tickers=[],
            keywords=[],
        )
    ]
    items = build_gap_intelligence_items(gaps, snaps, arts, news_lookback_hours=48)
    assert len(items) == 1
    assert items[0]["has_catalyst"] is True
    assert items[0]["catalyst"] is not None


def test_broad_noise_phrase_this_week_not_blocking_fda_headline() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    title = "FDA approved drug this week in pivotal trial"
    assert not det._headline_is_noise(title)


def test_listicle_pattern_detected() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    assert det._headline_is_noise("5 stocks to buy right now before earnings")
    assert not det._headline_is_noise("NVDA earnings beat estimates on strong data center demand")


# ---------------------------------------------------------------------------
# B30 Phase 4 — classify_mode_best_fit lock-ins
# ---------------------------------------------------------------------------
#
# These tests pin the gap-card mode-fit classifier. The classifier is advisory
# (it drives the "Best evaluated as: <mode>" tag on the gap card AND the
# on-click engine selection in `scannerSetupMode === "both"`), so any change
# to the heuristic must visibly justify itself through these lock-ins.


def test_mode_best_fit_returns_closed_set_value() -> None:
    """Defensive: every input combination resolves to one of the closed-set values."""
    mode, _ = classify_mode_best_fit(
        gap_pct=0.0, volume_vs_avg=1.0, has_catalyst=False
    )
    assert mode in MODE_BEST_FIT_VALUES


def test_mode_best_fit_earnings_catalyst_with_large_gap_picks_swing() -> None:
    """Earnings catalyst + 5% gap + high conviction → 3 swing signals, 0 day → swing."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=5.0,
        volume_vs_avg=1.2,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=75,
    )
    assert mode == "swing"
    assert any("structural catalyst" in r for r in reasons)
    assert any("large gap" in r for r in reasons)
    assert any("high-conviction" in r for r in reasons)
    # Day chips must NOT leak into the reasoning when the verdict is swing.
    assert not any("heavy volume" in r for r in reasons)


def test_mode_best_fit_merger_catalyst_is_structural_swing() -> None:
    """Merger catalyst is treated as structural (multi-day relevance), like earnings."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=4.0,
        volume_vs_avg=1.0,
        has_catalyst=True,
        catalyst_category="merger",
        catalyst_narrative_score=70,
    )
    assert mode == "swing"
    assert any("structural catalyst (merger)" in r for r in reasons)


def test_mode_best_fit_insider_catalyst_is_structural_swing() -> None:
    """Insider catalyst is treated as structural."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=3.5,
        volume_vs_avg=1.1,
        has_catalyst=True,
        catalyst_category="insider",
        catalyst_narrative_score=65,
    )
    assert mode == "swing"
    assert any("structural catalyst (insider)" in r for r in reasons)


def test_mode_best_fit_no_catalyst_with_heavy_volume_picks_day() -> None:
    """No catalyst + heavy volume + tradable range → 3 day signals, 1 swing → day."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=2.5,
        volume_vs_avg=3.2,
        has_catalyst=False,
    )
    assert mode == "day"
    assert any("heavy volume" in r for r in reasons)
    assert any("tradable intraday range" in r for r in reasons)
    assert any("momentum gap" in r for r in reasons)
    # Swing chips must NOT leak into the reasoning when the verdict is day.
    assert not any("structural catalyst" in r for r in reasons)


def test_mode_best_fit_macro_catalyst_with_heavy_volume_picks_day() -> None:
    """Macro catalyst is treated as tape-level (intraday fade common) — day-leaning."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=2.0,
        volume_vs_avg=2.5,
        has_catalyst=True,
        catalyst_category="macro",
        catalyst_narrative_score=40,
    )
    assert mode == "day"
    assert any("tape-level catalyst (macro)" in r for r in reasons)
    assert any("heavy volume" in r for r in reasons)


def test_mode_best_fit_analyst_catalyst_with_heavy_volume_picks_day() -> None:
    """Analyst catalyst is treated as tape-level (analyst upgrades often fade)."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=1.8,
        volume_vs_avg=2.2,
        has_catalyst=True,
        catalyst_category="analyst",
        catalyst_narrative_score=50,
    )
    assert mode == "day"
    assert any("tape-level catalyst (analyst)" in r for r in reasons)


def test_mode_best_fit_balanced_signals_returns_either() -> None:
    """1 swing signal + 1 day signal → margin 0 → either."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=2.0,
        volume_vs_avg=2.5,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=40,
    )
    assert mode == "either"
    # Either-verdict reasoning chips include BOTH sides so the user can see why.
    assert any("structural catalyst" in r for r in reasons)
    assert any("heavy volume" in r for r in reasons)


def test_mode_best_fit_margin_below_two_returns_either() -> None:
    """2 swing vs 1 day = margin 1 → still either (margin-2 rule)."""
    mode, _ = classify_mode_best_fit(
        gap_pct=4.0,
        volume_vs_avg=2.5,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=40,
    )
    assert mode == "either"


def test_mode_best_fit_unknown_catalyst_category_does_not_score_as_structural() -> None:
    """Unknown / freeform catalyst category falls through to no structural credit."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=2.0,
        volume_vs_avg=1.2,
        has_catalyst=True,
        catalyst_category="weather_event",
        catalyst_narrative_score=50,
    )
    # No swing signals fire (category not in {earnings, merger, insider}, score below 60).
    # Day signals: tradable intraday range only. 0 swing vs 1 day = margin 1 = either.
    assert mode == "either"
    assert not any("structural catalyst" in r for r in reasons)


def test_mode_best_fit_quiet_market_micro_gap_returns_either() -> None:
    """0.5% gap, 1.0x volume, no catalyst — 0 swing, 0 day → either (default)."""
    mode, reasons = classify_mode_best_fit(
        gap_pct=0.5,
        volume_vs_avg=1.0,
        has_catalyst=False,
    )
    assert mode == "either"
    # Neither side fires; reasons may be empty or contain only the no-catalyst note.
    assert all("structural catalyst" not in r and "large gap" not in r for r in reasons)


def test_mode_best_fit_negative_gap_uses_absolute_magnitude() -> None:
    """A -4% gap (gap-down) is just as 'large' as a +4% gap (gap-up)."""
    mode_up, _ = classify_mode_best_fit(
        gap_pct=4.0,
        volume_vs_avg=1.0,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=75,
    )
    mode_down, _ = classify_mode_best_fit(
        gap_pct=-4.0,
        volume_vs_avg=1.0,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=75,
    )
    # Direction does NOT affect mode fit — both go swing.
    assert mode_up == "swing"
    assert mode_down == "swing"


def test_mode_best_fit_huge_gap_no_volume_still_swing() -> None:
    """A 9% gap with no extraordinary volume but a structural catalyst still goes swing."""
    mode, _ = classify_mode_best_fit(
        gap_pct=9.0,
        volume_vs_avg=1.1,
        has_catalyst=True,
        catalyst_category="earnings",
        catalyst_narrative_score=80,
    )
    assert mode == "swing"


def test_mode_best_fit_in_build_gap_intelligence_items() -> None:
    """End-to-end: build_gap_intelligence_items emits mode_best_fit + reasons per row."""
    gaps = [
        PremarketGapCandidate(
            symbol="ZZZ",
            prev_close=100.0,
            premarket_price=105.0,
            gap_percent=5.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=5.0,
        )
    ]
    snaps = {"ZZZ": _snap("ZZZ", prev_close=100, price=105, vol=900_000, adv=400_000, name="Zeta Inc")}
    arts = [
        NewsArticle(
            article_id="zz-earn",
            published_at=datetime.now(timezone.utc),
            title="Zeta beats earnings expectations on strong revenue growth",
            description="",
            url="https://example.com",
            source="Reuters",
            tickers=["ZZZ"],
            keywords=["earnings", "revenue"],
        )
    ]
    items = build_gap_intelligence_items(gaps, snaps, arts, news_lookback_hours=48)
    assert len(items) == 1
    row = items[0]
    # The new fields are present on the wire (the load-bearing assertion — the
    # specific verdict depends on the NewsCatalystDetector narrative_score
    # which is exercised in its own test module).
    assert "mode_best_fit" in row
    assert "mode_best_fit_reasons" in row
    assert row["mode_best_fit"] in MODE_BEST_FIT_VALUES
    assert isinstance(row["mode_best_fit_reasons"], list)
    # The 5% gap should at minimum surface a 'large gap' reasoning chip
    # regardless of which side wins, since the chip fires on abs(gap_pct) >= 3.0.
    assert any("large gap" in r for r in row["mode_best_fit_reasons"])


def test_company_fallback_narrative_penalty_vs_ticker_match() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)
    art = NewsArticle(
        article_id="p1",
        published_at=ts,
        title="GameStop posts record revenue growth",
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=["GME"],
        keywords=["revenue"],
    )
    via_ticker = det.candidate_for_symbol(art, "GME", company_name="GameStop Corporation")
    art2 = NewsArticle(
        article_id="p2",
        published_at=ts,
        title="GameStop posts record revenue growth",
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=[],
        keywords=["revenue"],
    )
    via_company = det.candidate_for_symbol(art2, "GME", company_name="GameStop Corporation")
    assert via_ticker is not None and via_company is not None
    assert via_ticker.narrative_score >= via_company.narrative_score

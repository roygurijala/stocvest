from __future__ import annotations

from datetime import date

import pytest

from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict
from stocvest.signals.daily_briefing import DailyBriefingGenerator, DailyBriefingInput
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.news_catalyst_detector import NewsCatalystCandidate
from stocvest.signals.pdt_tracker import PDTAssessment


@pytest.mark.unit
def test_generate_includes_core_sections():
    gaps = (
        PremarketGapCandidate(
            symbol="AAPL",
            prev_close=100.0,
            premarket_price=103.0,
            gap_percent=3.0,
            day_volume=5_000_000,
            direction="up",
            rank_score=4.5,
        ),
    )
    cats = (
        NewsCatalystCandidate(
            article_id="n1",
            symbol="AAPL",
            title="Earnings beat",
            catalyst_type="earnings",
            direction="up",
            catalyst_score=0.9,
            sentiment_score=0.5,
            source="Reuters",
        ),
    )
    pdt = PDTAssessment(
        pdt_exempt=False,
        day_trades_in_window=2,
        max_non_exempt=3,
        rolling_business_days=5,
        allow_next_day_trade=True,
        warn_near_limit=True,
        at_limit=False,
    )
    swing = CompositeSignal(
        score=0.25,
        confidence=0.7,
        verdict=CompositeVerdict.BULLISH,
        contributions=[],
    )
    inp = DailyBriefingInput(
        briefing_date=date(2026, 4, 28),
        gap_candidates=gaps,
        news_catalysts=cats,
        pdt_assessment=pdt,
        swing_composite=swing,
        macro_headlines=("CPI cooler than expected",),
        geopolitical_line="No elevated headline risk.",
        market_session_summary="US equities: regular session.",
    )
    out = DailyBriefingGenerator().generate(inp)
    assert "2026-04-28" in out.markdown
    assert "Pre-market gaps" in out.markdown
    assert "AAPL" in out.markdown
    assert "PDT" in out.markdown
    assert "Warning" in out.markdown
    assert "Swing composite" in out.markdown
    assert "bullish" in out.markdown


@pytest.mark.unit
def test_empty_optional_sections():
    inp = DailyBriefingInput(briefing_date=date(2026, 4, 28))
    md = DailyBriefingGenerator().generate(inp).markdown
    assert "No gap candidates" in md
    assert "No ranked catalysts" in md
    assert "No PDT assessment" in md


@pytest.mark.unit
def test_respects_max_gaps_and_catalysts():
    gaps = tuple(
        PremarketGapCandidate(
            symbol=f"S{i}",
            prev_close=100.0,
            premarket_price=103.0,
            gap_percent=3.0,
            day_volume=1_000_000,
            direction="up",
            rank_score=float(10 - i),
        )
        for i in range(8)
    )
    cats = tuple(
        NewsCatalystCandidate(
            article_id=f"a{i}",
            symbol="X",
            title=f"News {i}",
            catalyst_type="general",
            direction="neutral",
            catalyst_score=0.9 - i * 0.01,
            sentiment_score=0.4,
            source=None,
        )
        for i in range(8)
    )
    inp = DailyBriefingInput(briefing_date=date(2026, 4, 28), gap_candidates=gaps, news_catalysts=cats)
    md = DailyBriefingGenerator(max_gaps=2, max_catalysts=3).generate(inp).markdown
    assert "S0" in md and "S1" in md and "S2" not in md
    assert "News 0" in md and "News 1" in md and "News 2" in md and "News 3" not in md


@pytest.mark.unit
def test_pdt_exempt_and_at_limit_lines():
    exempt = DailyBriefingInput(
        briefing_date=date(2026, 4, 28),
        pdt_assessment=PDTAssessment(
            pdt_exempt=True,
            day_trades_in_window=5,
            max_non_exempt=3,
            rolling_business_days=5,
            allow_next_day_trade=True,
            warn_near_limit=False,
            at_limit=False,
        ),
    )
    assert "PDT-exempt" in DailyBriefingGenerator().generate(exempt).markdown

    blocked = DailyBriefingInput(
        briefing_date=date(2026, 4, 28),
        pdt_assessment=PDTAssessment(
            pdt_exempt=False,
            day_trades_in_window=3,
            max_non_exempt=3,
            rolling_business_days=5,
            allow_next_day_trade=False,
            warn_near_limit=False,
            at_limit=True,
        ),
    )
    md = DailyBriefingGenerator().generate(blocked).markdown
    assert "Blocked" in md

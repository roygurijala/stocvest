"""
Phase 2.5j: cross-component day-trading pipeline smoke test.

Exercises gap scan → catalyst ranking → intraday setups → PDT posture → daily
briefing in one flow using synthetic inputs (no network).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from stocvest.data.models import NewsArticle, Newssentiment, Snapshot, Timeframe, Bar
from stocvest.signals.daily_briefing import DailyBriefingGenerator, DailyBriefingInput
from stocvest.signals.day_trading_scanner import IntradaySetupScanner, PremarketGapScanner
from stocvest.signals.news_catalyst_detector import NewsCatalystDetector
from stocvest.signals.pdt_tracker import PDTAssessment, PDTUserState, PDTTracker


def _snapshot(
    symbol: str,
    *,
    prev_close: float,
    pre: float,
    vol: float,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        pre_market_price=pre,
        day_volume=vol,
    )


def _bar(symbol: str, close: float, dt: datetime, *, vol: float = 200_000) -> Bar:
    return Bar(
        symbol=symbol,
        timestamp=dt,
        timeframe=Timeframe.MIN_1,
        open=close,
        high=close * 1.002,
        low=close * 0.998,
        close=close,
        volume=vol,
    )


def _opening_block(base: datetime, symbol: str) -> list[Bar]:
    bars: list[Bar] = []
    for i in range(15):
        price = 100.0 + ((i % 3) * 0.1)
        bars.append(
            _bar(
                symbol,
                price,
                base + timedelta(minutes=i),
                vol=120_000,
            )
        )
    return bars


@pytest.mark.unit
def test_phase25_pre_market_to_briefing_pipeline() -> None:
    snaps = [
        _snapshot("GAP1", prev_close=100.0, pre=104.0, vol=12_000_000),
        _snapshot("FLAT", prev_close=50.0, pre=50.2, vol=1_000_000),
    ]
    gaps = PremarketGapScanner(min_abs_gap_percent=2.0).scan_snapshots(snaps, limit=5)
    assert gaps and gaps[0].symbol == "GAP1"

    articles = [
        NewsArticle(
            article_id="a1",
            published_at=datetime(2026, 4, 28, 11, 0, tzinfo=timezone.utc),
            title="GAP1 reports strong earnings beat",
            description="Revenue guidance raised",
            url="https://example.com/1",
            source="Reuters",
            tickers=["GAP1"],
            keywords=["earnings"],
            sentiment=Newssentiment.BULLISH,
            sentiment_score=0.55,
        ),
    ]
    catalysts = NewsCatalystDetector(min_score=0.35).detect(articles, limit=5)
    assert catalysts

    base = datetime(2026, 4, 28, 9, 30, tzinfo=timezone.utc)
    bars_by_symbol = {
        "GAP1": _opening_block(base, "GAP1")
        + [
            _bar("GAP1", 100.2, base + timedelta(minutes=15), vol=100_000),
            _bar("GAP1", 102.2, base + timedelta(minutes=16), vol=350_000),
        ]
    }
    setups = IntradaySetupScanner(min_score=0.35).scan(bars_by_symbol, limit=5)
    assert setups

    pdt_state = PDTUserState(user_id="user-1", day_trade_dates=(date(2026, 4, 23), date(2026, 4, 24)), pdt_exempt=False)
    pdt_view = PDTTracker().assess(pdt_state, as_of=date(2026, 4, 28))

    briefing = DailyBriefingGenerator().generate(
        DailyBriefingInput(
            briefing_date=date(2026, 4, 28),
            gap_candidates=tuple(gaps),
            news_catalysts=tuple(catalysts),
            pdt_assessment=pdt_view,
            market_session_summary="Synthetic pre-market / RTH boundary test.",
        )
    )
    assert "GAP1" in briefing.markdown
    assert "PDT" in briefing.markdown
    assert isinstance(pdt_view, PDTAssessment)

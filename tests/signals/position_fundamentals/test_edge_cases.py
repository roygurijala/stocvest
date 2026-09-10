"""Edge-case tests for Position fundamentals hardening."""

from __future__ import annotations

import json
from datetime import date
from unittest.mock import patch

import httpx
import pytest
import respx

from stocvest.data.fundamentals_models import (
    FinancialRatios,
    IncomeStatement,
    PositionFundamentalsSnapshot,
)
from stocvest.data.fundamentals_provider import FMPFundamentalsProvider
from stocvest.signals.position_fundamentals.common import (
    normalize_pct_rate,
    normalize_positive_multiple,
    yoy_ratio,
)
from stocvest.signals.position_fundamentals.f1_profitability import score_f1_profitability
from stocvest.signals.position_fundamentals.f4_valuation import apply_value_trap_guard
from stocvest.signals.position_fundamentals.types import PositionPillarResult
from stocvest.signals.position_fundamentals_analyzer import (
    PositionFundamentalsAnalyzer,
    prepare_snapshot,
)
from tests.signals.position_fundamentals.conftest import quality_snapshot

FMP_BASE = "https://financialmodelingprep.com/stable"


@pytest.mark.unit
class TestNormalizationHelpers:
    def test_normalize_pct_rate_from_whole_percent(self) -> None:
        assert normalize_pct_rate(22.5) == pytest.approx(0.225)

    def test_normalize_pct_rate_already_decimal(self) -> None:
        assert normalize_pct_rate(0.225) == pytest.approx(0.225)

    def test_normalize_positive_multiple_rejects_negative_pe(self) -> None:
        assert normalize_positive_multiple(-5.0) is None
        assert normalize_positive_multiple(18.0) == 18.0

    def test_yoy_none_when_prior_negative(self) -> None:
        assert yoy_ratio(10.0, -5.0) is None


@pytest.mark.unit
class TestFmpPercentageRoe:
    def test_f1_handles_whole_percent_roe(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="AAPL",
            configured=True,
            ratios=[
                FinancialRatios(
                    symbol="AAPL",
                    as_of_date=date(2025, 3, 31),
                    return_on_equity=22.0,
                    net_profit_margin=0.24,
                )
            ],
            income_statements=[
                IncomeStatement(symbol="AAPL", as_of_date=date(2025, 3, 31), revenue=1.0)
            ],
        )
        result = score_f1_profitability(snap)
        assert result.score is not None
        assert result.score >= 62
        assert any("ROE" in c and "strong" in c for c in result.chips)


@pytest.mark.unit
class TestValueTrapChipPriority:
    def test_guard_chip_not_truncated(self) -> None:
        pillar = PositionPillarResult(
            pillar_id="F4",
            label="Valuation",
            weight=15,
            status="active",
            score=75,
            verdict="bullish",
            reasoning="test",
            chips=[f"filler-{i}" for i in range(6)],
        )
        guarded = apply_value_trap_guard(
            pillar,
            f2_verdict="bearish",
            f2_score=30,
            pe_ratio=10.0,
        )
        assert guarded.chips[0].startswith("Value-trap guard")


@pytest.mark.unit
class TestPrepareSnapshot:
    def test_sorts_unsorted_rows_newest_first(self) -> None:
        snap = quality_snapshot()
        snap.income_statements = list(reversed(snap.income_statements))
        prepared = prepare_snapshot(snap)
        dates = [r.as_of_date for r in prepared.income_statements]
        assert dates == sorted(dates, reverse=True)


@pytest.mark.unit
class TestCorruptCacheRefetch:
    @pytest.mark.asyncio
    @respx.mock
    async def test_corrupt_cache_triggers_refetch(self) -> None:
        rows = [{"date": "2025-03-31", "symbol": "AAPL", "revenue": 100.0}]
        route = respx.get(f"{FMP_BASE}/income-statement").mock(
            return_value=httpx.Response(200, json=rows)
        )
        with (
            patch("stocvest.data.fundamentals_provider._api_key", return_value="test-key"),
            patch("stocvest.data.fundamentals_provider._cache_get", return_value="{not-json"),
            patch("stocvest.data.fundamentals_provider._cache_set"),
        ):
            provider = FMPFundamentalsProvider()
            got = await provider.get_income_statements("AAPL")

        assert route.called
        assert len(got) == 1


@pytest.mark.unit
class TestAnalyzerEdgeCases:
    def test_unsorted_snapshot_still_scores(self) -> None:
        snap = quality_snapshot()
        snap.income_statements = list(reversed(snap.income_statements))
        result = PositionFundamentalsAnalyzer().analyze(snap)
        assert result.status == "active"
        assert result.score is not None

    def test_negative_beat_counts_ignored(self) -> None:
        from stocvest.signals.position_fundamentals_analyzer import PositionFundamentalsContext

        snap = quality_snapshot()
        result = PositionFundamentalsAnalyzer().analyze(
            snap,
            context=PositionFundamentalsContext(quarters_beating=-5, quarters_missing=-2),
        )
        f5 = next(p for p in result.pillars if p.pillar_id == "F5")
        assert not any("Beat streak" in c for c in f5.chips)

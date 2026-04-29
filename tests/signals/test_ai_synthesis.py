from __future__ import annotations

import pytest

from stocvest.signals.ai_synthesis import AISynthesis, SynthesisInput, TradeAction
from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal
from stocvest.signals.geopolitical_scanner import GeopoliticalRiskAssessment, GeopoliticalRiskLevel
from stocvest.signals.macro_events import MacroEvent, MacroEventType


def make_input() -> SynthesisInput:
    composite = CompositeScoreEngine().compute(
        [
            LayerSignal(layer="technical", score=0.7, confidence=0.9),
            LayerSignal(layer="news", score=0.3, confidence=0.8),
            LayerSignal(layer="macro", score=-0.2, confidence=0.7),
        ],
        regime="sideways",
    )
    macro_events = [
        MacroEvent(
            event_type=MacroEventType.CPI,
            title="CPI cools",
            severity=0.9,
            direction=1,
            confidence=0.85,
            rationale="Inflation softer than expected.",
        )
    ]
    geopolitical = GeopoliticalRiskAssessment(
        risk_level=GeopoliticalRiskLevel.MEDIUM,
        risk_score=0.45,
        market_bias=-1,
        confidence=0.75,
        summary="Regional tension elevated.",
        drivers=["sanctions"],
        impacted_regions=["Europe"],
    )
    return SynthesisInput(
        symbol="AAPL",
        regime="sideways",
        composite=composite,
        macro_events=macro_events,
        geopolitical=geopolitical,
        news_items_scored=8,
    )


@pytest.mark.unit
def test_build_prompt_includes_required_sections():
    ai = AISynthesis()
    prompt = ai.build_prompt(make_input())
    assert "action, conviction, confidence" in prompt
    assert "symbol=AAPL" in prompt
    assert "layer_contributions=" in prompt
    assert "macro_events=" in prompt
    assert "geopolitical=" in prompt


@pytest.mark.unit
def test_parse_response_happy_path():
    ai = AISynthesis()
    verdict = ai.parse_response(
        symbol="AAPL",
        response_text=(
            '{"action":"buy","conviction":0.72,"confidence":0.8,'
            '"position_size_pct":0.25,"stop_loss_pct":0.03,"take_profit_pct":0.08,'
            '"rationale":"Composite supports upside with manageable macro risk.",'
            '"risks":["CPI surprise"],"timeframe":"swing"}'
        ),
    )
    assert verdict.action == TradeAction.BUY
    assert verdict.symbol == "AAPL"
    assert verdict.position_size_pct == pytest.approx(0.25)
    assert verdict.timeframe == "swing"


@pytest.mark.unit
def test_parse_response_extracts_json_from_wrapped_text():
    ai = AISynthesis()
    verdict = ai.parse_response(
        symbol="TSLA",
        response_text=(
            "Final decision below:\n"
            '{"action":"hold","conviction":0.4,"confidence":0.5,'
            '"position_size_pct":0.0,"stop_loss_pct":0.02,"take_profit_pct":0.04,'
            '"rationale":"Mixed signal stack.","risks":["headline risk"],"timeframe":"intraday"}'
        ),
    )
    assert verdict.action == TradeAction.HOLD
    assert verdict.symbol == "TSLA"


@pytest.mark.unit
def test_parse_response_rejects_invalid_action():
    ai = AISynthesis()
    with pytest.raises(ValueError, match="Invalid action"):
        ai.parse_response(
            symbol="SPY",
            response_text=(
                '{"action":"accumulate","conviction":0.6,"confidence":0.6,'
                '"position_size_pct":0.2,"stop_loss_pct":0.03,"take_profit_pct":0.06,'
                '"rationale":"N/A","risks":[],"timeframe":"swing"}'
            ),
        )


@pytest.mark.unit
def test_parse_response_clamps_numeric_fields_and_limits_risks():
    ai = AISynthesis()
    verdict = ai.parse_response(
        symbol="MSFT",
        response_text=(
            '{"action":"sell","conviction":3.0,"confidence":-1.0,'
            '"position_size_pct":2.0,"stop_loss_pct":-0.3,"take_profit_pct":9.0,'
            '"rationale":"x","risks":["r1","r2","r3","r4","r5","r6"],"timeframe":"position"}'
        ),
    )
    assert verdict.action == TradeAction.SELL
    assert verdict.conviction == pytest.approx(1.0)
    assert verdict.confidence == pytest.approx(0.0)
    assert verdict.position_size_pct == pytest.approx(1.0)
    assert verdict.stop_loss_pct == pytest.approx(0.0)
    assert verdict.take_profit_pct == pytest.approx(1.0)
    assert len(verdict.risks) == 5

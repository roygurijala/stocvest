"""
Phase 2e: AI synthesis prompt builder and response parser.

Transforms normalized layer outputs into a deterministic LLM prompt and parses
LLM JSON verdicts into typed structures.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from stocvest.signals.composite_score import CompositeSignal
from stocvest.signals.geopolitical_scanner import GeopoliticalRiskAssessment
from stocvest.signals.macro_events import MacroEvent


class TradeAction(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


@dataclass(frozen=True)
class SynthesisInput:
    symbol: str
    regime: str
    composite: CompositeSignal
    macro_events: list[MacroEvent]
    geopolitical: GeopoliticalRiskAssessment
    news_items_scored: int


@dataclass(frozen=True)
class SynthesisVerdict:
    symbol: str
    action: TradeAction
    conviction: float          # 0.0 - 1.0
    confidence: float          # 0.0 - 1.0
    position_size_pct: float   # 0.0 - 1.0
    stop_loss_pct: float       # 0.0 - 1.0
    take_profit_pct: float     # 0.0 - 1.0
    rationale: str
    risks: list[str]
    timeframe: str


class AISynthesis:
    """
    Prompt builder and parser for final signal verdict.

    This class deliberately does not call external APIs; it handles only
    deterministic prompt creation and response normalization/parsing.
    """

    def build_prompt(self, payload: SynthesisInput) -> str:
        compact_macro = [
            {
                "event_type": event.event_type.value,
                "severity": event.severity,
                "direction": event.direction,
                "confidence": event.confidence,
            }
            for event in payload.macro_events[:10]
        ]
        compact_contrib = [
            {
                "layer": contrib.layer,
                "raw_score": contrib.raw_score,
                "effective_weight": contrib.effective_weight,
                "weighted_value": contrib.weighted_value,
            }
            for contrib in payload.composite.contributions
        ]

        return (
            "You are STOCVEST signal synthesizer. Produce a single trading verdict.\n"
            "Use risk-first logic: if uncertainty or geopolitical/macro risk is high, reduce size or hold.\n"
            "Return strict JSON only with keys:\n"
            "action, conviction, confidence, position_size_pct, stop_loss_pct, take_profit_pct, "
            "rationale, risks, timeframe.\n"
            "Constraints:\n"
            "- action: buy|sell|hold\n"
            "- conviction/confidence/position_size_pct/stop_loss_pct/take_profit_pct: float 0.0-1.0\n"
            "- rationale: <= 280 chars\n"
            "- risks: list[str], max 5 items\n"
            "- timeframe: one of ['intraday','swing','position']\n\n"
            f"symbol={payload.symbol}\n"
            f"regime={payload.regime}\n"
            f"composite_score={payload.composite.score}\n"
            f"composite_confidence={payload.composite.confidence}\n"
            f"composite_verdict={payload.composite.verdict.value}\n"
            f"layer_contributions={json.dumps(compact_contrib)}\n"
            f"macro_events={json.dumps(compact_macro)}\n"
            f"geopolitical={json.dumps({'risk_level': payload.geopolitical.risk_level.value, 'risk_score': payload.geopolitical.risk_score, 'market_bias': payload.geopolitical.market_bias, 'confidence': payload.geopolitical.confidence})}\n"
            f"news_items_scored={payload.news_items_scored}\n"
        )

    def parse_response(self, *, symbol: str, response_text: str) -> SynthesisVerdict:
        payload = self._extract_json(response_text)

        action_raw = str(payload["action"]).strip().lower()
        if action_raw not in {a.value for a in TradeAction}:
            raise ValueError(f"Invalid action: {action_raw}")

        timeframe = str(payload.get("timeframe", "swing")).strip().lower()
        if timeframe not in {"intraday", "swing", "position"}:
            raise ValueError(f"Invalid timeframe: {timeframe}")

        return SynthesisVerdict(
            symbol=symbol,
            action=TradeAction(action_raw),
            conviction=self._clamp(float(payload["conviction"]), 0.0, 1.0),
            confidence=self._clamp(float(payload["confidence"]), 0.0, 1.0),
            position_size_pct=self._clamp(float(payload["position_size_pct"]), 0.0, 1.0),
            stop_loss_pct=self._clamp(float(payload["stop_loss_pct"]), 0.0, 1.0),
            take_profit_pct=self._clamp(float(payload["take_profit_pct"]), 0.0, 1.0),
            rationale=str(payload.get("rationale", "")).strip()[:280],
            risks=self._normalize_risks(payload.get("risks", [])),
            timeframe=timeframe,
        )

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, flags=re.DOTALL)
            if not match:
                raise ValueError("Response did not contain JSON payload.") from None
            return json.loads(match.group(0))

    @staticmethod
    def _normalize_risks(risks: Any) -> list[str]:
        if not isinstance(risks, list):
            return []
        normalized = [str(item).strip() for item in risks if str(item).strip()]
        return normalized[:5]

    @staticmethod
    def _clamp(value: float, lower: float, upper: float) -> float:
        return max(lower, min(upper, value))

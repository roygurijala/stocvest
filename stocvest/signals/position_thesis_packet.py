"""Position thesis packet — ADR-004 POS-AI-1 (glass-box Tier 2 input).

Pure, deterministic builder that turns a position composite body (F1-F5 pillars +
seven layers) into a structured bull / bear / open-questions packet. Every bullet
cites the pillar (``F1``..``F5``) or layer (``layer:sector``) it came from, so an
LLM can *narrate* the thesis without ever inventing or overriding the math.

No network, no LLM. `POST /v1/signals/ai/explanations` (POS-AI-2) consumes this
packet; free users get a deterministic brief straight from it, paid users get a
Claude narration keyed by ``pillar_snapshot_hash``.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

Confidence = Literal["high", "medium", "low"]

# Pillar verdict thresholds mirror position_fundamentals/common.py (bullish >=62, bearish <=38).
_PILLAR_BULLISH = 62
_PILLAR_BEARISH = 38
_PILLAR_IDS = ("F1", "F2", "F3", "F4", "F5")
# Supporting layers narrated in the thesis, in stable display order.
_SUPPORT_LAYERS = ("technical", "sector", "macro", "news", "geopolitical", "internals")
_LAYER_LABELS = {
    "technical": "Weekly structural trend",
    "sector": "Sector relative strength",
    "macro": "Macro regime",
    "news": "News flow",
    "geopolitical": "Geopolitical exposure",
    "internals": "Market internals",
}
_MAX_BULLETS_PER_SECTION = 6


@dataclass(frozen=True)
class ThesisBullet:
    text: str
    source: str  # "F1".."F5" or "layer:<name>"
    confidence: Confidence

    def to_api_dict(self) -> dict[str, Any]:
        return {"text": self.text, "source": self.source, "confidence": self.confidence}


@dataclass(frozen=True)
class PositionThesisPacket:
    symbol: str
    verdict: str
    bull_case: list[ThesisBullet] = field(default_factory=list)
    bear_case: list[ThesisBullet] = field(default_factory=list)
    open_questions: list[ThesisBullet] = field(default_factory=list)
    pillar_snapshot_hash: str = ""

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "verdict": self.verdict,
            "bull_case": [b.to_api_dict() for b in self.bull_case],
            "bear_case": [b.to_api_dict() for b in self.bear_case],
            "open_questions": [b.to_api_dict() for b in self.open_questions],
            "pillar_snapshot_hash": self.pillar_snapshot_hash,
        }


@dataclass(frozen=True)
class _Pillar:
    pillar_id: str
    label: str
    score: int | None
    verdict: str
    reasoning: str
    data_quality: str
    status: str


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _layer_row(body: dict[str, Any], layer: str) -> dict[str, Any]:
    for row in body.get("layers") or []:
        if isinstance(row, dict) and str(row.get("layer") or "").strip().lower() == layer:
            return row
    return {}


def _parse_pillars(body: dict[str, Any]) -> dict[str, _Pillar]:
    fund = body.get("position_fundamentals")
    fund = fund if isinstance(fund, dict) else {}
    out: dict[str, _Pillar] = {}
    for p in fund.get("pillars") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("pillar_id") or "").strip().upper()
        if not pid:
            continue
        out[pid] = _Pillar(
            pillar_id=pid,
            label=str(p.get("label") or pid),
            score=_as_int(p.get("score")),
            verdict=str(p.get("verdict") or "neutral").strip().lower(),
            reasoning=str(p.get("reasoning") or "").strip(),
            data_quality=str(p.get("data_quality") or "unavailable").strip().lower(),
            status=str(p.get("status") or "unavailable").strip().lower(),
        )
    return out


def _confidence(data_quality: str, score: int | None) -> Confidence:
    if score is None:
        return "low"
    strength = abs(score - 50)
    dq = (data_quality or "").strip().lower()
    if dq == "high" and strength >= 20:
        return "high"
    if dq in ("high", "medium") and strength >= 10:
        return "medium"
    return "low"


def _pillar_line(p: _Pillar, tone: str) -> str:
    if p.reasoning:
        return p.reasoning
    score = f"{p.score}/100" if p.score is not None else "unscored"
    return f"{p.label} ({p.pillar_id}): {tone} at {score}."


def _pillar_snapshot_hash(body: dict[str, Any], pillars: dict[str, _Pillar]) -> str:
    payload = {
        "verdict": str(body.get("verdict") or body.get("signal_summary") or "").strip().lower(),
        "parameter_version": body.get("parameter_version"),
        "pillars": [
            {"id": pid, "score": pillars[pid].score, "verdict": pillars[pid].verdict}
            for pid in _PILLAR_IDS
            if pid in pillars
        ],
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def build_position_thesis_packet(body: dict[str, Any]) -> PositionThesisPacket:
    """Deterministically derive bull / bear / open-questions from a composite body."""
    symbol = str(body.get("symbol") or "").strip().upper()
    verdict = str(body.get("verdict") or body.get("signal_summary") or "neutral").strip().lower()
    pillars = _parse_pillars(body)
    snapshot_hash = _pillar_snapshot_hash(body, pillars)

    status = str(body.get("status") or "active").strip().lower()
    if status == "insufficient_data" or not pillars:
        return PositionThesisPacket(
            symbol=symbol,
            verdict=verdict,
            open_questions=[
                ThesisBullet(
                    text="Insufficient fundamentals coverage to build a thesis — verify data availability.",
                    source="layer:fundamentals",
                    confidence="low",
                )
            ],
            pillar_snapshot_hash=snapshot_hash,
        )

    bull: list[ThesisBullet] = []
    bear: list[ThesisBullet] = []
    questions: list[ThesisBullet] = []

    weakest_id = body.get("position_fundamentals")
    weakest_id = (
        str(weakest_id.get("weakest_pillar_id")).strip().upper()
        if isinstance(weakest_id, dict) and weakest_id.get("weakest_pillar_id")
        else None
    )

    # Pillars (F1..F5) in fixed order.
    for pid in _PILLAR_IDS:
        p = pillars.get(pid)
        if p is None:
            questions.append(
                ThesisBullet(
                    text=f"{pid} pillar unavailable — confirm against filings before relying on the read.",
                    source=pid,
                    confidence="low",
                )
            )
            continue
        if p.score is None or p.status != "active":
            questions.append(
                ThesisBullet(
                    text=f"{p.label} ({pid}) not scored ({p.status}) — data limited; verify against filings.",
                    source=pid,
                    confidence="low",
                )
            )
            continue
        conf = _confidence(p.data_quality, p.score)
        if p.score >= _PILLAR_BULLISH:
            bull.append(ThesisBullet(text=_pillar_line(p, "strong"), source=pid, confidence=conf))
        elif p.score <= _PILLAR_BEARISH:
            bear.append(ThesisBullet(text=_pillar_line(p, "weak"), source=pid, confidence=conf))
        if p.data_quality in ("low", "unavailable"):
            questions.append(
                ThesisBullet(
                    text=f"{p.label} ({pid}) rests on {p.data_quality} data quality — how complete are the filings?",
                    source=pid,
                    confidence="low",
                )
            )

    # Value-trap watch: F4 bearish/neutral while quality (F1/F2) is bullish.
    f1, f2, f4 = pillars.get("F1"), pillars.get("F2"), pillars.get("F4")
    if (
        f4 is not None
        and f4.score is not None
        and f4.verdict != "bullish"
        and f1 is not None
        and f2 is not None
        and f1.verdict == "bullish"
        and f2.verdict == "bullish"
    ):
        questions.append(
            ThesisBullet(
                text="Quality is strong (F1/F2) but valuation (F4) is not cheap — is the entry price attractive for a long hold?",
                source="F4",
                confidence="medium",
            )
        )

    # Weakest pillar always surfaces as a watch item (even if neutral).
    if weakest_id and weakest_id in pillars:
        wp = pillars[weakest_id]
        if not any(b.source == weakest_id for b in bear):
            score = f"{wp.score}/100" if wp.score is not None else "unscored"
            bear.append(
                ThesisBullet(
                    text=f"Weakest pillar: {wp.label} ({weakest_id}) at {score} — the first thing to watch.",
                    source=weakest_id,
                    confidence=_confidence(wp.data_quality, wp.score),
                )
            )

    # Supporting layers.
    for layer in _SUPPORT_LAYERS:
        row = _layer_row(body, layer)
        if not row:
            continue
        v = str(row.get("verdict") or "neutral").strip().lower()
        st = str(row.get("status") or "").strip().lower()
        if st in ("degraded", "unavailable"):
            continue
        reasoning = str(row.get("reasoning") or "").strip()
        text = reasoning or f"{_LAYER_LABELS.get(layer, layer)} reads {v}."
        if v == "bullish":
            bull.append(ThesisBullet(text=text, source=f"layer:{layer}", confidence="medium"))
        elif v == "bearish":
            bear.append(ThesisBullet(text=text, source=f"layer:{layer}", confidence="medium"))

    if not bear:
        questions.append(
            ThesisBullet(
                text="No layer currently contradicts the thesis — what would invalidate it (margin trend, leverage, sector rotation)?",
                source="layer:fundamentals",
                confidence="low",
            )
        )

    return PositionThesisPacket(
        symbol=symbol,
        verdict=verdict,
        bull_case=_dedupe(bull)[:_MAX_BULLETS_PER_SECTION],
        bear_case=_dedupe(bear)[:_MAX_BULLETS_PER_SECTION],
        open_questions=_dedupe(questions)[:_MAX_BULLETS_PER_SECTION],
        pillar_snapshot_hash=snapshot_hash,
    )


def _dedupe(bullets: list[ThesisBullet]) -> list[ThesisBullet]:
    seen: set[tuple[str, str]] = set()
    out: list[ThesisBullet] = []
    for b in bullets:
        key = (b.source, b.text)
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
    return out


def deterministic_investment_read(packet: PositionThesisPacket) -> str:
    """Free-tier / fallback brief woven from the packet — no LLM, non-advisory."""
    sym = packet.symbol or "This name"
    lead = f"On the Position desk (long-horizon quality), {sym} reads {packet.verdict} on fundamentals."
    parts = [lead]
    if packet.bull_case:
        parts.append(f"Bull: {packet.bull_case[0].text}")
    if packet.bear_case:
        parts.append(f"Watch: {packet.bear_case[0].text}")
    if packet.open_questions:
        parts.append(f"Open question: {packet.open_questions[0].text}")
    parts.append("Signal data only.")
    return " ".join(parts)

"""Position thesis-drift — ADR-004 POS-AI-7 (informational, never an alert/exit).

Pure, deterministic helpers that (1) snapshot the F1–F5 pillar scores/verdicts + overall
verdict from a position composite body at entry, and (2) later compare a fresh composite
against that stored baseline to surface pillars whose thesis has **degraded** (verdict
downgraded or score dropped materially).

This is glass-box and **informational only**: it is computed in the weekly capture sweep
(which already recomputes every name), reported in logs / job output, and NEVER closes a
position or fires an alert. The score-drop threshold is a monitoring sensitivity, not a
scoring constant — it does not feed the composite or move money.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

_PILLAR_IDS = ("F1", "F2", "F3", "F4", "F5")
# bullish > neutral > bearish; a lower current rank than baseline is a downgrade.
_VERDICT_RANK = {"bullish": 1, "neutral": 0, "bearish": -1}
# Material single-pillar score deterioration (0–100 scale). Monitoring sensitivity only.
_SCORE_DROP_THRESHOLD = 15


def _as_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _norm_verdict(value: Any) -> str:
    v = str(value or "").strip().lower()
    return v if v in _VERDICT_RANK else "neutral"


def _parse_pillars(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract ``{pillar_id: {label, score, verdict}}`` from a composite body."""
    fund = body.get("position_fundamentals")
    fund = fund if isinstance(fund, dict) else {}
    out: dict[str, dict[str, Any]] = {}
    for p in fund.get("pillars") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("pillar_id") or "").strip().upper()
        if not pid:
            continue
        out[pid] = {
            "label": str(p.get("label") or pid),
            "score": _as_int(p.get("score")),
            "verdict": _norm_verdict(p.get("verdict")),
        }
    return out


def build_pillar_snapshot(body: dict[str, Any]) -> dict[str, Any]:
    """Deterministic entry-time baseline: overall verdict + F1..F5 score/verdict."""
    pillars = _parse_pillars(body)
    return {
        "verdict": _norm_verdict(body.get("verdict")),
        "pillars": {
            pid: {"score": pillars[pid]["score"], "verdict": pillars[pid]["verdict"]}
            for pid in _PILLAR_IDS
            if pid in pillars
        },
    }


def pillar_snapshot_to_json(body: dict[str, Any]) -> str | None:
    """Compact JSON baseline for persistence, or ``None`` when no pillars are present."""
    snap = build_pillar_snapshot(body)
    if not snap["pillars"]:
        return None
    return json.dumps(snap, separators=(",", ":"), sort_keys=True)


@dataclass(frozen=True)
class PillarDrift:
    pillar_id: str
    label: str
    from_score: int | None
    to_score: int | None
    from_verdict: str
    to_verdict: str
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pillar_id": self.pillar_id,
            "label": self.label,
            "from_score": self.from_score,
            "to_score": self.to_score,
            "from_verdict": self.from_verdict,
            "to_verdict": self.to_verdict,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class ThesisDriftResult:
    symbol: str
    has_drift: bool
    verdict_from: str
    verdict_to: str
    verdict_downgraded: bool
    degraded_pillars: list[PillarDrift] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "has_drift": self.has_drift,
            "verdict_from": self.verdict_from,
            "verdict_to": self.verdict_to,
            "verdict_downgraded": self.verdict_downgraded,
            "degraded_pillars": [p.to_dict() for p in self.degraded_pillars],
        }


def _coerce_baseline(baseline: str | dict[str, Any] | None) -> dict[str, Any] | None:
    if baseline is None:
        return None
    if isinstance(baseline, str):
        try:
            data = json.loads(baseline)
        except (ValueError, TypeError):
            return None
        return data if isinstance(data, dict) else None
    return baseline if isinstance(baseline, dict) else None


def compute_pillar_drift(
    baseline: str | dict[str, Any] | None,
    current_body: dict[str, Any],
    *,
    symbol: str = "",
    score_drop_threshold: int = _SCORE_DROP_THRESHOLD,
) -> ThesisDriftResult | None:
    """Compare a stored pillar baseline against a fresh composite body.

    Returns a :class:`ThesisDriftResult` (``has_drift`` true when the overall verdict was
    downgraded or any pillar degraded), or ``None`` when there is no usable baseline. A pillar
    is "degraded" when its verdict is downgraded or its score drops by ``score_drop_threshold``
    or more. Purely informational — the caller logs/reports it, never acts on it.
    """
    base = _coerce_baseline(baseline)
    if not base:
        return None
    base_pillars = base.get("pillars")
    if not isinstance(base_pillars, dict):
        base_pillars = {}

    sym = str(symbol or current_body.get("symbol") or "").strip().upper()
    cur_pillars = _parse_pillars(current_body)

    verdict_from = _norm_verdict(base.get("verdict"))
    verdict_to = _norm_verdict(current_body.get("verdict"))
    verdict_downgraded = _VERDICT_RANK[verdict_to] < _VERDICT_RANK[verdict_from]

    degraded: list[PillarDrift] = []
    for pid in _PILLAR_IDS:
        b = base_pillars.get(pid)
        c = cur_pillars.get(pid)
        if not isinstance(b, dict) or c is None:
            continue  # can only assess pillars present in both snapshots
        from_score = _as_int(b.get("score"))
        to_score = c["score"]
        from_verdict = _norm_verdict(b.get("verdict"))
        to_verdict = c["verdict"]
        reasons: list[str] = []
        if _VERDICT_RANK[to_verdict] < _VERDICT_RANK[from_verdict]:
            reasons.append(f"verdict {from_verdict}→{to_verdict}")
        if (
            from_score is not None
            and to_score is not None
            and (from_score - to_score) >= score_drop_threshold
        ):
            reasons.append(f"score {from_score}→{to_score} (−{from_score - to_score})")
        if reasons:
            degraded.append(
                PillarDrift(
                    pillar_id=pid,
                    label=c["label"],
                    from_score=from_score,
                    to_score=to_score,
                    from_verdict=from_verdict,
                    to_verdict=to_verdict,
                    reasons=reasons,
                )
            )

    return ThesisDriftResult(
        symbol=sym,
        has_drift=bool(verdict_downgraded or degraded),
        verdict_from=verdict_from,
        verdict_to=verdict_to,
        verdict_downgraded=verdict_downgraded,
        degraded_pillars=degraded,
    )

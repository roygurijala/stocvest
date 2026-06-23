"""News relevance × impact × age weighting for the composite News layer.

The legacy News layer averages per-article polarity (±1) weighted only by recency ×
mention × source, so a single low-relevance, low-impact, stale headline prints an
extreme score. This module scales each article's contribution by:

* **relevance** (0–1): is this a credible source materially covering *this* ticker?
* **impact**    (0–1): how market-moving is the catalyst (earnings/M&A/FDA > opinion)?

and provides a **confidence** that shrinks the layer score toward neutral (50) when the
total effective evidence is thin. Relevance/impact come from Claude (read-through cache,
attached to the article dict as ``claude_relevance`` / ``claude_impact``) when available,
else a validated heuristic fallback (publisher credibility + catalyst-keyword magnitude —
see ``scripts/validate_news_relevance_impact.py``).

Pure / side-effect free so it is unit-testable and Lambda-safe. Gating lives in the
caller (``NewsAnalyzer``); this module only does math.
"""

from __future__ import annotations

from typing import Any

from stocvest.api.services.news_relevance import CATALYST_SCORES, publisher_credibility_rank

#: Floors so a generic, lower-credibility article still counts a little (never zero).
IMPACT_FLOOR = 0.25
RELEVANCE_FLOOR = 0.35
#: Total effective weight at which the layer reaches full confidence (no shrink). Calibrated
#: in the validation sweep: ~one fresh, direct, credible, high-impact article.
CONFIDENCE_K = 0.6

_MAX_CATALYST_PTS = max(CATALYST_SCORES.values()) if CATALYST_SCORES else 40


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _catalyst_points(title: str, desc: str) -> int:
    """First-match catalyst magnitude (mirrors news_relevance ranking)."""
    blob = f"{title} {desc}".lower()
    for keywords, pts in CATALYST_SCORES.items():
        if any(kw in blob for kw in keywords):
            return pts
    return 0


def heuristic_impact(title: str, desc: str) -> float:
    """Catalyst-type magnitude → impact in [IMPACT_FLOOR, 1.0]."""
    pts = _catalyst_points(title, desc)
    return IMPACT_FLOOR + (1.0 - IMPACT_FLOOR) * (pts / _MAX_CATALYST_PTS)


def heuristic_relevance(publisher_name: str) -> float:
    """Publisher credibility rank (~0..20) → relevance in [RELEVANCE_FLOOR, 1.0]."""
    cred = publisher_credibility_rank(publisher_name)
    return RELEVANCE_FLOOR + (1.0 - RELEVANCE_FLOOR) * min(1.0, cred / 20.0)


def _publisher_name(article: dict[str, Any]) -> str:
    pub = article.get("publisher")
    if isinstance(pub, dict):
        return str(pub.get("name") or "")
    return str(article.get("source") or "")


def _claude_value(article: dict[str, Any], key: str) -> float | None:
    raw = article.get(key)
    if raw is None:
        return None
    try:
        return _clamp01(float(raw))
    except (TypeError, ValueError):
        return None


def resolve_relevance_impact(article: dict[str, Any], symbol: str) -> tuple[float, float, str]:
    """Return ``(relevance, impact, source)`` for one article.

    Prefers Claude estimates carried on the article dict (``claude_relevance`` /
    ``claude_impact``); falls back to the validated heuristic. ``source`` is
    ``"claude"`` only when *both* Claude values are present and valid, else ``"heuristic"``.
    """
    _ = symbol  # reserved: per-ticker relevance already resolved upstream by the scorer
    c_rel = _claude_value(article, "claude_relevance")
    c_imp = _claude_value(article, "claude_impact")
    if c_rel is not None and c_imp is not None:
        return c_rel, c_imp, "claude"
    title = str(article.get("title") or "")
    desc = str(article.get("description") or "")
    return heuristic_relevance(_publisher_name(article)), heuristic_impact(title, desc), "heuristic"


def confidence_from_weight(total_effective_weight: float, k: float = CONFIDENCE_K) -> float:
    """Shrink factor in [0,1]: thin total evidence → low confidence → score pulled to 50."""
    if k <= 0:
        return 1.0
    return _clamp01(total_effective_weight / k)


def apply_confidence_shrink(score: int, confidence: float) -> int:
    """Pull a 0–100 score toward the neutral midpoint by ``1 - confidence``."""
    return int(round(50.0 + (float(score) - 50.0) * _clamp01(confidence)))

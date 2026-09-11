"""Unit tests for the Position-desk copy compliance guard (ADR-004 POS-D12).

Covers (1) the banned-phrase detector, (2) that it does NOT false-positive on legitimate
fundamental terminology, (3) the AI-read enforcement fallback, and (4) a regression that
the deterministic Position copy (thesis packet, gem "why", deterministic read) is clean.
"""

from __future__ import annotations

from typing import Any

import pytest

from stocvest.signals.position_copy_guard import (
    enforce_position_read,
    find_position_copy_violations,
    position_copy_is_clean,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "text",
    [
        "This is a strong buy for long-term holders.",
        "Investors should own this name for the next decade.",
        "You must buy before earnings.",
        "It's time to buy the leader here.",
        "Buy now while it's cheap.",
        "Back up the truck on this one.",
        "A screaming buy at these levels.",
        "This is a no-brainer.",
        "We recommend adding to the position.",
        "The stock is clearly undervalued.",
        "Shares look overvalued after the run.",
        "You should allocate to this name.",
        "Allocate a position here for the cycle.",
        "Guaranteed returns over five years.",
    ],
)
def test_flags_advice_and_hype_in_product_mode(text: str) -> None:
    # Product mode (allow_advice=False) enforces the full advice + hype contract.
    assert not position_copy_is_clean(text, allow_advice=False)
    assert find_position_copy_violations(text, allow_advice=False)


# PERSONAL-MODE: advice/recommendation/valuation language is allowed; HYPE stays blocked.
@pytest.mark.parametrize(
    "text",
    [
        "This is a strong buy for long-term holders.",
        "Investors should own this name for the next decade.",
        "You must buy before earnings.",
        "Buy now while it's cheap.",
        "We recommend adding to the position.",
        "The stock is clearly undervalued.",
        "Shares look overvalued after the run.",
        "You should allocate to this name.",
    ],
)
def test_personal_mode_allows_advice(text: str) -> None:
    assert position_copy_is_clean(text, allow_advice=True), find_position_copy_violations(
        text, allow_advice=True
    )


@pytest.mark.parametrize(
    "text",
    [
        "Back up the truck on this one.",
        "A screaming buy at these levels.",
        "This is a no-brainer.",
        "Guaranteed returns over five years.",
        "Load up the boat here.",
        "It's a sure thing.",
    ],
)
def test_personal_mode_still_blocks_hype(text: str) -> None:
    # Even in personal mode the HYPE / return-guarantee family is enforced.
    assert not position_copy_is_clean(text, allow_advice=True)
    assert find_position_copy_violations(text, allow_advice=True)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "F4 valuation reads neutral at 48/100.",
        "Management has a strong record of capital allocation.",
        "The company allocates capital efficiently across segments.",
        "A large share buyback reduced the float.",
        "Historical signal accuracy does not guarantee future results.",
        "Weakest pillar: F4 valuation — the first thing to watch.",
        "Trades at a premium to peers on P/E and EV/EBITDA.",
        "Screening only. Signal data only.",
        "Sell-side coverage is thin, so estimates are noisy.",  # 'sell-side' must not trip
    ],
)
def test_does_not_flag_legitimate_copy(text: str) -> None:
    # Legitimate copy is clean under the strict (product) contract, hence in every mode.
    assert position_copy_is_clean(text, allow_advice=False), find_position_copy_violations(
        text, allow_advice=False
    )


def test_find_returns_unique_ordered_labels() -> None:
    text = "strong buy — a strong buy — you should own it, it's undervalued"
    labels = find_position_copy_violations(text, allow_advice=False)
    # deduped
    assert len(labels) == len(set(labels))
    assert "strong buy/sell" in labels
    assert "action advice" in labels
    assert "valuation conclusion" in labels


def test_enforce_keeps_clean_ai_text() -> None:
    text, used_fallback = enforce_position_read(
        "F1 profitability is strong; F4 valuation is not cheap. Signal data only.",
        "DET FALLBACK",
    )
    assert used_fallback is False
    assert text.startswith("F1 profitability")


def test_enforce_falls_back_on_banned_ai_text() -> None:
    text, used_fallback = enforce_position_read(
        "This is a strong buy — back up the truck.", "DET FALLBACK"
    )
    assert used_fallback is True
    assert text == "DET FALLBACK"


@pytest.mark.parametrize("ai_text", ["", "   ", None])
def test_enforce_falls_back_on_empty_ai_text(ai_text: str | None) -> None:
    text, used_fallback = enforce_position_read(ai_text, "DET FALLBACK")
    assert used_fallback is True
    assert text == "DET FALLBACK"


def test_default_mode_follows_personal_advice_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no explicit ``allow_advice`` the guard reads the settings flag."""
    from stocvest.utils.config import get_settings

    try:
        # Personal mode ON → advice allowed, hype still blocked.
        monkeypatch.setenv("STOCVEST_PERSONAL_ADVICE_MODE_ENABLED", "true")
        get_settings.cache_clear()
        assert position_copy_is_clean("This is a strong buy for the long run.")
        assert not position_copy_is_clean("Back up the truck on this one.")
        _, used_fallback = enforce_position_read("You should own this. Signal data only.", "DET")
        assert used_fallback is False

        # Product mode OFF → full advice + hype contract enforced.
        monkeypatch.setenv("STOCVEST_PERSONAL_ADVICE_MODE_ENABLED", "false")
        get_settings.cache_clear()
        assert not position_copy_is_clean("This is a strong buy for the long run.")
        _, used_fallback = enforce_position_read("You should own this. Signal data only.", "DET")
        assert used_fallback is True
    finally:
        get_settings.cache_clear()


# --- Regression: deterministic Position copy must be compliant ------------------------

_LABELS = {
    "F1": "Profitability & quality",
    "F2": "Growth",
    "F3": "Balance sheet & solvency",
    "F4": "Valuation",
    "F5": "Earnings quality & consistency",
}


def _pillar(pid: str, score: int | None, verdict: str, *, dq: str = "high", status: str = "active") -> dict[str, Any]:
    return {
        "pillar_id": pid,
        "label": _LABELS[pid],
        "score": score,
        "verdict": verdict,
        "reasoning": f"{_LABELS[pid]} read {score}/100.",
        "data_quality": dq,
        "status": status,
        "chips": [],
    }


def _body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "symbol": "AAPL",
        "verdict": "bullish",
        "position_fundamentals": {
            "weakest_pillar_id": "F4",
            "pillars": [
                _pillar("F1", 82, "bullish"),
                _pillar("F2", 74, "bullish"),
                _pillar("F3", 70, "neutral"),
                _pillar("F4", 48, "neutral"),
                _pillar("F5", 72, "bullish"),
            ],
        },
        "layers": [
            {"layer": "technical", "score": 66, "verdict": "bullish", "status": "available"},
            {"layer": "sector", "score": 44, "verdict": "bearish", "status": "available"},
        ],
    }
    body.update(over)
    return body


def test_thesis_packet_and_deterministic_read_are_compliant() -> None:
    from stocvest.signals.position_thesis_packet import (
        build_position_thesis_packet,
        deterministic_investment_read,
    )

    packet = build_position_thesis_packet(_body())
    for bullet in packet.bull_case + packet.bear_case + packet.open_questions:
        assert position_copy_is_clean(bullet.text, allow_advice=False), find_position_copy_violations(
            bullet.text, allow_advice=False
        )
    assert position_copy_is_clean(deterministic_investment_read(packet), allow_advice=False)

    # insufficient-data path
    empty = build_position_thesis_packet({"symbol": "ZZZ", "status": "insufficient_data"})
    for bullet in empty.open_questions:
        assert position_copy_is_clean(bullet.text, allow_advice=False)
    assert position_copy_is_clean(deterministic_investment_read(empty), allow_advice=False)


def _gem_features_body() -> dict[str, Any]:
    body = _body()
    body["position_fundamentals"]["score"] = 78
    body["position_fundamentals"]["verdict"] = "bullish"
    body["position_fundamentals"]["data_quality"] = "high"
    return body


def test_gem_why_copy_is_compliant() -> None:
    from stocvest.signals.position_gem_gates import (
        TIER_GEM,
        TIER_INSUFFICIENT,
        TIER_MONITOR,
        TIER_STRONG,
        build_gem_why,
        extract_candidate_features,
    )

    feats = extract_candidate_features(_gem_features_body())
    for tier in (TIER_GEM, TIER_STRONG, TIER_MONITOR, TIER_INSUFFICIENT):
        # exercise both the all-pass and G8-fail branches for INSUFFICIENT
        gates = {f"G{i}": True for i in range(1, 10)}
        why = build_gem_why(feats, gates, tier)
        assert position_copy_is_clean(why, allow_advice=False), (
            tier,
            find_position_copy_violations(why, allow_advice=False),
        )
    gates_g8_fail = {f"G{i}": True for i in range(1, 10)}
    gates_g8_fail["G8"] = False
    why = build_gem_why(feats, gates_g8_fail, TIER_INSUFFICIENT)
    assert position_copy_is_clean(why, allow_advice=False), find_position_copy_violations(
        why, allow_advice=False
    )

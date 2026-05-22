"""Causal signal narrative builder."""

from stocvest.signals.causal_narrative import build_causal_narrative


def _layer(layer: str, verdict: str, *, status: str = "available", reasoning: str = "") -> dict:
    return {
        "layer": layer,
        "verdict": verdict,
        "status": status,
        "reasoning": reasoning,
        "score": 50,
    }


def test_bullish_macro_bearish_chain():
    narrative = build_causal_narrative(
        signal_summary="bullish",
        layers=[
            _layer("macro", "bearish", reasoning="Risk-off tape: SPY weak and VIX firm."),
            _layer("sector", "bearish"),
            _layer("technical", "neutral"),
            _layer("news", "neutral"),
            _layer("geopolitical", "neutral"),
            _layer("internals", "bearish"),
        ],
    )
    assert narrative["informational_only"] is True
    assert narrative["setup_bias"] == "bullish"
    assert len(narrative["chain"]) >= 2
    assert narrative["chain"][0]["layer"] == "macro"
    assert "macro" in narrative["chain"][0]["caused_by"] or narrative["chain"][0]["role"] == "root_cause"
    assert "buy" not in narrative["summary"].lower()
    assert "sell" not in narrative["summary"].lower()


def test_supportive_layers_omit_blocking_chain():
    narrative = build_causal_narrative(
        signal_summary="bearish",
        layers=[
            _layer("macro", "bearish"),
            _layer("sector", "bearish"),
            _layer("technical", "bearish"),
            _layer("news", "neutral"),
            _layer("geopolitical", "neutral"),
            _layer("internals", "bearish"),
        ],
    )
    assert narrative["chain"] == []
    assert "execution" not in narrative["summary"].lower() or "headwind" in narrative["summary"].lower()


def test_substantive_reasoning_used():
    custom = "Earnings drift: no fresh catalyst in the 120h window."
    narrative = build_causal_narrative(
        signal_summary="bullish",
        layers=[
            _layer("macro", "neutral"),
            _layer("news", "neutral", reasoning=custom),
            _layer("technical", "bearish"),
            _layer("sector", "neutral"),
            _layer("geopolitical", "neutral"),
            _layer("internals", "neutral"),
        ],
    )
    news_note = narrative["layer_notes"].get("news")
    assert news_note is not None
    assert custom[:40] in news_note["because"]


def test_execution_note_appended():
    narrative = build_causal_narrative(
        signal_summary="bullish",
        layers=[_layer("technical", "bullish")],
        execution_note="Risk/reward below the swing desk minimum.",
    )
    assert "Risk/reward" in narrative["summary"] or "Execution" in narrative["summary"]

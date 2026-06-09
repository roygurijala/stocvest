"""IPO roadshow narrative weight adjustments for news layer."""

from __future__ import annotations

from datetime import date

from stocvest.signals.news_ipo_narrative import classify_ipo_narrative_adjustment


def test_competitive_openai_narrative_downweights_msft() -> None:
    adj = classify_ipo_narrative_adjustment(
        "MSFT",
        "OpenAI IPO threatens Microsoft AI dominance",
        "",
        as_of=date(2026, 6, 15),
    )
    assert adj.tag == "ipo_narrative_competitive"
    assert adj.weight_multiplier < 0.5


def test_stake_repricing_boosts_msft() -> None:
    adj = classify_ipo_narrative_adjustment(
        "MSFT",
        "Microsoft OpenAI stake repriced as IPO filing advances",
        "Azure partnership",
        as_of=date(2026, 6, 15),
    )
    assert adj.tag == "ipo_narrative_stake_repricing"
    assert adj.weight_multiplier > 1.0


def test_no_adjustment_outside_roadshow() -> None:
    adj = classify_ipo_narrative_adjustment(
        "MSFT",
        "OpenAI threatens Microsoft",
        "",
        as_of=date(2024, 1, 1),
    )
    assert adj.tag is None
    assert adj.weight_multiplier == 1.0

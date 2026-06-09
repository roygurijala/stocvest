"""IPO ecosystems scanner payload."""

from __future__ import annotations

from stocvest.api.services.ipo_ecosystems_api import build_ipo_ecosystems_payload


def test_build_ipo_ecosystems_payload_has_three_entities() -> None:
    body = build_ipo_ecosystems_payload()
    entities = {e["trigger_entity"] for e in body["ecosystems"]}
    assert entities == {"SpaceX", "Anthropic", "OpenAI"}
    spacex = next(e for e in body["ecosystems"] if e["trigger_entity"] == "SpaceX")
    assert "XOVR" in spacex["etf_holders"]
    assert "GOOGL" in spacex["corporate_backers"]

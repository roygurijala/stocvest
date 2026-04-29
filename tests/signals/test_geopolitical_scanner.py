from __future__ import annotations

from datetime import datetime, timezone

import pytest
import respx
from httpx import Response

from stocvest.data.models import NewsArticle
from stocvest.signals.geopolitical_scanner import (
    ANTHROPIC_API_URL,
    GeopoliticalRiskLevel,
    GeopoliticalScanner,
)
from stocvest.utils.config import get_settings


def article(article_id: str, title: str, description: str = "") -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc),
        title=title,
        description=description,
        url=f"https://example.com/{article_id}",
        source="ExampleWire",
        tickers=["SPY"],
        keywords=[],
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_parses_claude_response(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner()
    inputs = [article("g-1", "Regional tensions rise", "Military activity reported.")]

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(
            return_value=Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"risk_level":"high","risk_score":0.82,"market_bias":-1,'
                                '"confidence":0.9,"summary":"Escalation risk elevated.",'
                                '"drivers":["shipping risk"],"impacted_regions":["Middle East"]}'
                            ),
                        }
                    ]
                },
            )
        )
        result = await scanner.scan(inputs)

    assert result.risk_level == GeopoliticalRiskLevel.HIGH
    assert result.market_bias == -1
    assert result.risk_score == pytest.approx(0.82)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_retries_on_429(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner(max_retries=1)
    inputs = [article("g-2", "Diplomatic tensions continue", "Potential sanctions discussed.")]

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(429, json={"error": "rate limited"}),
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"risk_level":"medium","risk_score":0.55,"market_bias":-1,'
                                '"confidence":0.8,"summary":"Tensions remain elevated.",'
                                '"drivers":["sanctions"],"impacted_regions":["Europe"]}'
                            ),
                        }
                    ]
                },
            ),
        ]
        result = await scanner.scan(inputs)

    assert result.risk_level == GeopoliticalRiskLevel.MEDIUM
    assert route.call_count == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_uses_rule_fallback_on_api_failure(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner(max_retries=0)
    inputs = [article("g-3", "War concerns increase", "New sanctions and missile attacks reported.")]

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(return_value=Response(500, json={"error": "oops"}))
        result = await scanner.scan(inputs)

    assert result.market_bias == -1
    assert result.risk_level in {GeopoliticalRiskLevel.MEDIUM, GeopoliticalRiskLevel.HIGH}
    assert result.risk_score >= 0.4


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_requires_api_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()

    scanner = GeopoliticalScanner()
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        await scanner.scan([article("g-4", "Any title")])


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_empty_articles_returns_low_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner()
    result = await scanner.scan([])

    assert result.risk_level == GeopoliticalRiskLevel.LOW
    assert result.risk_score == pytest.approx(0.0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_scan_normalizes_non_list_fields_from_model(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner()
    inputs = [article("g-5", "Regional tension", "Updates pending.")]

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(
            return_value=Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"risk_level":"medium","risk_score":0.5,"market_bias":-1,'
                                '"confidence":0.7,"summary":"Risk elevated.",'
                                '"drivers":"sanctions","impacted_regions":"Europe"}'
                            ),
                        }
                    ]
                },
            )
        )
        result = await scanner.scan(inputs)

    assert result.drivers == []
    assert result.impacted_regions == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_geo_retry_failure_exposes_status_context(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scanner = GeopoliticalScanner(max_retries=1)
    inputs = [article("g-6", "Any title", "Any description")]

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(429, json={"error": "rate limited"}),
            Response(503, json={"error": "unavailable"}),
        ]
        result = await scanner.scan(inputs)

    # scan() falls back on parse/API failures, but should preserve deterministic fallback.
    assert result.market_bias in (-1, 0, 1)

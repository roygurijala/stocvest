"""Unit tests for the Position Research bundle service (ADR-004 POS-AI-4)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from stocvest.api.services import position_research as pr
from stocvest.data.edgar_10k import TenKRiskExcerpt
from stocvest.data.models import UserProfile
from stocvest.data.sec_xbrl import CompanyFacts, XbrlFact

pytestmark = pytest.mark.unit


def _paid() -> UserProfile:
    return UserProfile(user_id="u-paid", subscription_plan="swing_day_pro")


def _free() -> UserProfile:
    return UserProfile(user_id="u-free", subscription_plan="free")


def _settings(*, enabled: bool = True, cap: int = 15) -> SimpleNamespace:
    return SimpleNamespace(
        stocvest_position_research_enabled=enabled,
        stocvest_position_research_max_per_user_per_day=cap,
    )


def _excerpt() -> TenKRiskExcerpt:
    return TenKRiskExcerpt(
        symbol="AAPL",
        excerpt="Supply chain concentration could adversely affect results.",
        source_url="https://www.sec.gov/Archives/edgar/data/320193/x/aapl-10k.htm",
        filing_date="2025-10-30",
        form="10-K",
        truncated=False,
    )


def _developments() -> pr.RecentDevelopments:
    return pr.RecentDevelopments(
        summary="The company reported record services revenue and raised its buyback.",
        key_points=["Services revenue at record high", "Buyback increased"],
        sources=[{"title": "Reuters", "url": "https://reuters.com/x"}],
    )


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.expires: dict[str, int] = {}

    def get(self, key: str) -> Any:
        return self.store.get(key)

    def incr(self, key: str) -> int:
        self.store[key] = int(self.store.get(key, 0)) + 1
        return self.store[key]

    def expire(self, key: str, ttl: int) -> None:
        self.expires[key] = ttl


def _company_facts() -> CompanyFacts:
    return CompanyFacts(
        symbol="AAPL",
        entity_name="Apple Inc.",
        facts=[
            XbrlFact(
                key="revenue",
                label="Revenue",
                value=383_000_000_000.0,
                unit="USD",
                fiscal_year=2024,
                period_end="2024-09-28",
                form="10-K",
                filed="2024-11-01",
            )
        ],
        source_url="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K",
    )


@pytest.fixture(autouse=True)
def _no_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    # Default: no Redis (budget is a no-op). Individual tests override.
    monkeypatch.setattr(pr, "get_sync_redis", lambda: None)


@pytest.fixture(autouse=True)
def _no_xbrl_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep the SEC XBRL fetch network-free by default (unit tests). Financials-specific
    # tests override this. Without it, the third gather() call would hit the real API.
    async def _none_facts(*a: Any, **k: Any) -> None:
        return None

    monkeypatch.setattr(pr, "fetch_company_facts", _none_facts)


@pytest.mark.asyncio
async def test_disabled_flag_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings(enabled=False))
    called = {"recent": False, "edgar": False}

    async def _recent(*a: Any, **k: Any) -> None:
        called["recent"] = True
        return None

    async def _edgar(*a: Any, **k: Any) -> None:
        called["edgar"] = True
        return None

    monkeypatch.setattr(pr, "_fetch_recent_developments", _recent)
    monkeypatch.setattr(pr, "fetch_10k_item_1a", _edgar)

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "disabled"
    assert called == {"recent": False, "edgar": False}  # no external calls


@pytest.mark.asyncio
async def test_free_user_requires_upgrade(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())
    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_free())
    assert out.status == "upgrade_required"
    assert out.upgrade_available is True


@pytest.mark.asyncio
async def test_ok_bundle_merges_both_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())

    async def _recent(symbol: str, company_name: str | None) -> pr.RecentDevelopments:
        return _developments()

    async def _edgar(symbol: str, **k: Any) -> TenKRiskExcerpt:
        return _excerpt()

    monkeypatch.setattr(pr, "_fetch_recent_developments", _recent)
    monkeypatch.setattr(pr, "fetch_10k_item_1a", _edgar)

    out = await pr.build_position_research_bundle(symbol="aapl", user_profile=_paid())
    assert out.status == "ok"
    assert out.symbol == "AAPL"
    d = out.to_api_dict()
    assert d["recent_developments"]["summary"].startswith("The company reported")
    assert d["recent_developments"]["scored"] is False
    assert d["risk_factors"]["scored"] is False
    assert d["risk_factors"]["source_url"].startswith("https://www.sec.gov/")
    assert "not part of the STOCVEST signal" in d["disclaimer"]


@pytest.mark.asyncio
async def test_partial_bundle_when_only_edgar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())
    monkeypatch.setattr(pr, "_fetch_recent_developments", lambda *a, **k: _none())
    monkeypatch.setattr(pr, "fetch_10k_item_1a", lambda *a, **k: _some_excerpt())

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "ok"
    d = out.to_api_dict()
    assert d["recent_developments"] is None
    assert d["risk_factors"] is not None


async def _none() -> None:
    return None


async def _some_excerpt() -> TenKRiskExcerpt:
    return _excerpt()


@pytest.mark.asyncio
async def test_empty_bundle_when_both_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())
    monkeypatch.setattr(pr, "_fetch_recent_developments", lambda *a, **k: _none())
    monkeypatch.setattr(pr, "fetch_10k_item_1a", lambda *a, **k: _none())

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "empty"
    assert out.to_api_dict()["recent_developments"] is None
    assert out.to_api_dict()["risk_factors"] is None


@pytest.mark.asyncio
async def test_over_budget_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings(cap=2))
    fake = _FakeRedis()
    fake.store[f"stocvest:pos_research:u-paid:{pr._ny_date()}"] = 2  # already at cap
    monkeypatch.setattr(pr, "get_sync_redis", lambda: fake)

    called = {"edgar": False}

    async def _edgar(*a: Any, **k: Any) -> None:
        called["edgar"] = True
        return None

    monkeypatch.setattr(pr, "fetch_10k_item_1a", _edgar)

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "over_budget"
    assert called["edgar"] is False


def test_budget_increments_and_sets_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(pr, "get_sync_redis", lambda: fake)
    assert pr._within_daily_budget("u1", 3) is True
    assert pr._within_daily_budget("u1", 3) is True
    key = f"stocvest:pos_research:u1:{pr._ny_date()}"
    assert fake.store[key] == 2
    assert fake.expires[key] == 90_000


def test_budget_zero_limit_is_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(pr, "get_sync_redis", lambda: fake)
    assert pr._within_daily_budget("u1", 0) is True
    assert fake.store == {}  # never touched Redis


@pytest.mark.asyncio
async def test_recent_developments_parses_perplexity(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _sonar(*, prompt: str, search_recency_filter: str, cache_key: str) -> dict[str, Any]:
        return {
            "summary": "Raised guidance after a strong quarter.",
            "key_points": ["Guidance raised", "Guidance raised"],  # dedup
            "sources": [{"title": "WSJ", "url": "https://wsj.com/x"}, {"title": "no-url"}],
        }

    monkeypatch.setattr(pr, "perplexity_sonar_json", _sonar)
    out = await pr._fetch_recent_developments("AAPL", "Apple Inc")
    assert out is not None
    assert out.summary.startswith("Raised guidance")
    assert out.key_points == ["Guidance raised"]
    assert out.sources == [{"title": "WSJ", "url": "https://wsj.com/x"}, {"title": "no-url"}]


@pytest.mark.asyncio
async def test_recent_developments_none_on_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _sonar(**k: Any) -> None:
        return None

    monkeypatch.setattr(pr, "perplexity_sonar_json", _sonar)
    assert await pr._fetch_recent_developments("AAPL", None) is None


@pytest.mark.asyncio
async def test_ok_bundle_includes_sec_financials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())
    monkeypatch.setattr(pr, "_fetch_recent_developments", lambda *a, **k: _none())
    monkeypatch.setattr(pr, "fetch_10k_item_1a", lambda *a, **k: _none())

    async def _facts(*a: Any, **k: Any) -> CompanyFacts:
        return _company_facts()

    monkeypatch.setattr(pr, "fetch_company_facts", _facts)

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "ok"  # financials alone is enough to be non-empty
    d = out.to_api_dict()
    assert d["recent_developments"] is None
    assert d["risk_factors"] is None
    assert d["financials"]["scored"] is False
    assert d["financials"]["entity_name"] == "Apple Inc."
    assert d["financials"]["facts"][0]["key"] == "revenue"
    assert "CIK=0000320193" in d["financials"]["source_url"]


@pytest.mark.asyncio
async def test_empty_bundle_when_all_three_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pr, "get_settings", lambda: _settings())
    monkeypatch.setattr(pr, "_fetch_recent_developments", lambda *a, **k: _none())
    monkeypatch.setattr(pr, "fetch_10k_item_1a", lambda *a, **k: _none())
    # fetch_company_facts already returns None via the autouse fixture.

    out = await pr.build_position_research_bundle(symbol="AAPL", user_profile=_paid())
    assert out.status == "empty"
    assert out.to_api_dict()["financials"] is None

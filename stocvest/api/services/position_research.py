"""Position Research bundle — ADR-004 POS-AI-4 (external context, INFORMATIONAL / not scored).

Assembles the Position deep-dive "Research" tab from **external** primary/secondary
sources, all clearly badged "External · not scored" and NEVER fed into the pillar math:

  * Recent developments — a cited, neutral Perplexity Sonar summary of what has changed
    for the company recently (reuses the shared ``perplexity_sonar_json`` client + cache).
  * Risk factors excerpt — a truncated Item 1A pull from the company's latest SEC 10-K
    (``stocvest.data.edgar_10k``), with the source filing URL.
  * Financials (POS-AI-10) — headline latest-fiscal-year figures straight from the SEC
    XBRL companyfacts API (``stocvest.data.sec_xbrl``), primary-source display only.

Gating (ships DARK):
  * ``STOCVEST_POSITION_RESEARCH_ENABLED`` flag, AND
  * the caller is a paid user (``has_ai_explanations``), AND
  * within the per-user/day budget (Redis soft cap; no-op without Redis).

Everything is best-effort: a missing key, cold ticker, or unparsable filing degrades to a
partial (or empty) bundle rather than raising. The prompt forbids advice; combined with the
"not scored" framing and source citations this mirrors the existing assistant web-context
compliance posture (see ``assistant_web_context.py``).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from stocvest.data.edgar_10k import TenKRiskExcerpt, fetch_10k_item_1a
from stocvest.data.models import UserProfile
from stocvest.data.sec_xbrl import CompanyFacts, fetch_company_facts
from stocvest.data.perplexity_client import perplexity_cache_key, perplexity_sonar_json
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

_NY = ZoneInfo("America/New_York")

RESEARCH_DISCLAIMER = (
    "External research shown for context only — not part of the STOCVEST signal or a "
    "recommendation. Verify against primary sources."
)

BundleStatus = Literal["ok", "disabled", "upgrade_required", "over_budget", "empty"]


@dataclass(frozen=True)
class RecentDevelopments:
    summary: str = ""
    key_points: list[str] = field(default_factory=list)
    sources: list[dict[str, str]] = field(default_factory=list)

    @property
    def has_data(self) -> bool:
        return bool(self.summary)

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary,
            "key_points": list(self.key_points),
            "sources": [dict(s) for s in self.sources],
            "scored": False,
        }


@dataclass(frozen=True)
class PositionResearchBundle:
    symbol: str
    status: BundleStatus
    recent_developments: RecentDevelopments | None = None
    risk_factors: TenKRiskExcerpt | None = None
    financials: CompanyFacts | None = None
    upgrade_available: bool = False
    disclaimer: str = RESEARCH_DISCLAIMER

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "status": self.status,
            "recent_developments": (
                self.recent_developments.to_api_dict()
                if self.recent_developments and self.recent_developments.has_data
                else None
            ),
            "risk_factors": self.risk_factors.to_api_dict() if self.risk_factors else None,
            "financials": (
                self.financials.to_api_dict()
                if self.financials and self.financials.has_data
                else None
            ),
            "upgrade_available": self.upgrade_available,
            "disclaimer": self.disclaimer,
        }


def _ny_date() -> str:
    return datetime.now(_NY).strftime("%Y-%m-%d")


def _within_daily_budget(user_id: str, limit: int) -> bool:
    """Soft per-user/day cap. No-op (allow) when Redis is unavailable or ``limit`` <= 0."""
    if limit <= 0:
        return True
    r: Any = get_sync_redis()
    if r is None:
        return True
    key = f"stocvest:pos_research:{user_id}:{_ny_date()}"
    try:
        current = int(r.get(key) or 0)
        if current >= limit:
            return False
        n = int(r.incr(key))
        if n == 1:
            r.expire(key, 90_000)  # ~25h — survives to next NY midnight
        return True
    except Exception as exc:  # noqa: BLE001 — budget is best-effort, never block on Redis
        _LOG.warning("position_research budget check failed: %s", type(exc).__name__)
        return True


def _normalize_str_list(raw: object, *, limit: int = 5, clip: int = 240) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for row in raw:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text[:clip])
        if len(out) >= limit:
            break
    return out


def _normalize_sources(raw: object, *, limit: int = 6) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in raw:
        title = ""
        url = ""
        if isinstance(row, dict):
            title = str(row.get("title") or row.get("name") or row.get("source") or "").strip()
            url = str(row.get("url") or row.get("link") or "").strip()
        elif isinstance(row, str):
            title = row.strip()
        if not title and not url:
            continue
        key = (url or title).lower()
        if key in seen:
            continue
        seen.add(key)
        entry: dict[str, str] = {}
        if title:
            entry["title"] = title[:200]
        if url.startswith("http"):
            entry["url"] = url[:500]
        if entry:
            out.append(entry)
        if len(out) >= limit:
            break
    return out


async def _fetch_recent_developments(symbol: str, company_name: str | None) -> RecentDevelopments | None:
    sym = symbol.strip().upper()
    who = f"{company_name.strip()} ({sym})" if company_name else sym
    prompt = f"""You are a long-horizon equity research assistant. Summarize the most \
material RECENT developments for {who} over the past ~3 months that a long-term investor \
would want to know — earnings, guidance, management/strategy changes, major products, \
regulatory or legal events, capital allocation (buybacks/dividends/M&A). Be neutral, \
factual, and grounded in reputable sources. Do NOT give buy/sell/hold advice, price \
targets, position sizing, or predictions — report what happened and why it matters, not \
what anyone should do.

Return ONLY valid JSON:
{{
  "summary": "3-5 sentence neutral factual summary",
  "key_points": ["short factual development", "..."],
  "sources": [{{"title": "publisher or headline", "url": "https://..."}}]
}}

Use [] when none apply. Max 5 key_points and 6 sources."""

    try:
        data = await perplexity_sonar_json(
            prompt=prompt,
            search_recency_filter="month",
            cache_key=perplexity_cache_key("position_research", sym),
        )
    except Exception as exc:  # noqa: BLE001 — best-effort
        _LOG.warning("position_research perplexity failed for %s: %s", sym, type(exc).__name__)
        return None
    if not data:
        return None
    summary = str(data.get("summary") or data.get("answer") or "").strip()
    if not summary:
        return None
    return RecentDevelopments(
        summary=summary[:1200],
        key_points=_normalize_str_list(data.get("key_points")),
        sources=_normalize_sources(data.get("sources")),
    )


async def build_position_research_bundle(
    *,
    symbol: str,
    user_profile: UserProfile,
    company_name: str | None = None,
) -> PositionResearchBundle:
    """Build the Position Research bundle (recent developments + 10-K risk excerpt).

    Fully gated + best-effort. External content is never scored and never mutates the
    composite. Concurrency: the Perplexity call and the SEC fetch run in parallel.
    """
    sym = (symbol or "").strip().upper()
    settings = get_settings()

    if not settings.stocvest_position_research_enabled:
        return PositionResearchBundle(symbol=sym, status="disabled")

    if not user_profile.has_ai_explanations:
        return PositionResearchBundle(
            symbol=sym, status="upgrade_required", upgrade_available=True
        )

    cap = int(settings.stocvest_position_research_max_per_user_per_day)
    if not _within_daily_budget(user_profile.user_id, cap):
        return PositionResearchBundle(symbol=sym, status="over_budget")

    recent, excerpt, financials = await asyncio.gather(
        _fetch_recent_developments(sym, company_name),
        fetch_10k_item_1a(sym),
        fetch_company_facts(sym),
    )

    has_recent = recent is not None and recent.has_data
    has_financials = financials is not None and financials.has_data
    if not has_recent and excerpt is None and not has_financials:
        return PositionResearchBundle(symbol=sym, status="empty")

    return PositionResearchBundle(
        symbol=sym,
        status="ok",
        recent_developments=recent if has_recent else None,
        risk_factors=excerpt,
        financials=financials if has_financials else None,
    )

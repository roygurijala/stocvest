"""Perplexity Sonar backfill for news and macro layers when Polygon/Benzinga are thin."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from stocvest.data.benzinga_client import BenzingaMultiResult
from stocvest.data.perplexity_client import perplexity_cache_key, perplexity_sonar_json
from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.macro_analyzer import MacroLayerResult
from stocvest.signals.news_analyzer import NewsLayerResult
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


@dataclass(frozen=True)
class PerplexityNewsEnrichment:
    symbol: str
    summary: str
    sentiment: str
    headwinds: list[str] = field(default_factory=list)
    catalysts: list[str] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    source: str = "perplexity_sonar"


@dataclass(frozen=True)
class PerplexityMacroEnrichment:
    symbol: str
    summary: str
    verdict: str
    macro_headlines: list[str] = field(default_factory=list)
    risk_factors: list[str] = field(default_factory=list)
    upcoming_events: list[str] = field(default_factory=list)
    source: str = "perplexity_sonar"


def _company_label(symbol: str, ticker_ref: TickerReference | None) -> str:
    sym = symbol.strip().upper()
    name = str(ticker_ref.name or "").strip() if ticker_ref else ""
    country = str(ticker_ref.country_code or "").strip().upper() if ticker_ref else ""
    parts = [sym]
    if name:
        parts.append(name)
    if country:
        parts.append(f"({country} ADR)" if ticker_ref and ticker_ref.is_adr() else f"({country})")
    return " — ".join(parts)


def needs_perplexity_news(news: NewsLayerResult, benzinga_data: BenzingaMultiResult | None) -> bool:
    if news.article_count > 0:
        return False
    if news.data_state == "fresh" and news.analyst_sub_score not in (None, 0.0):
        return False
    if benzinga_data and benzinga_data.wim and str(benzinga_data.wim.reason or "").strip():
        return False
    return news.data_state in ("stale", "fresh")


def needs_perplexity_macro(
    macro: MacroLayerResult,
    *,
    ticker_ref: TickerReference | None,
    economic_event_count: int,
) -> bool:
    if economic_event_count > 0 and macro.event_today:
        return False
    if macro.upcoming_events:
        return False
    if ticker_ref and ticker_ref.is_adr() and str(ticker_ref.country_code or "").strip().upper() not in ("", "US"):
        return True
    if not macro.macro_warnings and economic_event_count == 0:
        return True
    return False


def _normalize_str_list(raw: object, *, limit: int = 5) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for row in raw:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text[:240])
        if len(out) >= limit:
            break
    return out


def _sentiment_to_score(sentiment: str) -> float:
    s = str(sentiment or "").strip().lower()
    if s in ("bullish", "positive"):
        return 0.35
    if s in ("bearish", "negative"):
        return -0.35
    return 0.0


async def fetch_news_enrichment(
    symbol: str,
    ticker_ref: TickerReference | None = None,
) -> PerplexityNewsEnrichment | None:
    sym = symbol.strip().upper()
    label = _company_label(sym, ticker_ref)
    prompt = f"""You are a US equity swing-trading research assistant.
For {label}, summarize material company-specific news from the last 30 days.

Include:
- earnings / guidance surprises
- regulatory or legal risk (including class actions if material)
- country / FX / policy drivers for ADRs
- sector-specific catalysts

Return ONLY valid JSON:
{{
  "summary": "2-3 sentence neutral summary",
  "sentiment": "bullish|bearish|neutral",
  "headwinds": ["..."],
  "catalysts": ["..."],
  "citations": ["source title or publisher — optional URL"]
}}

Use empty arrays when none apply. Max 4 items per list."""
    data = await perplexity_sonar_json(
        prompt=prompt,
        search_recency_filter="month",
        cache_key=perplexity_cache_key("news", sym),
    )
    if not data:
        return None
    summary = str(data.get("summary") or "").strip()
    if not summary:
        return None
    return PerplexityNewsEnrichment(
        symbol=sym,
        summary=summary[:600],
        sentiment=str(data.get("sentiment") or "neutral").strip().lower() or "neutral",
        headwinds=_normalize_str_list(data.get("headwinds")),
        catalysts=_normalize_str_list(data.get("catalysts")),
        citations=_normalize_str_list(data.get("citations"), limit=6),
    )


async def fetch_macro_enrichment(
    symbol: str,
    ticker_ref: TickerReference | None = None,
) -> PerplexityMacroEnrichment | None:
    sym = symbol.strip().upper()
    label = _company_label(sym, ticker_ref)
    country = str(ticker_ref.country_code or "US").strip().upper() if ticker_ref else "US"
    prompt = f"""You are a macro strategist covering US-listed equities.
For {label}, describe macro and policy context relevant to the next 1-2 weeks.

Focus on:
- home-country policy (especially if ADR / country={country})
- FX, rates, inflation, and sovereign risk
- sector-wide macro drivers (not generic US-only filler)
- scheduled macro events that could move this name

Return ONLY valid JSON:
{{
  "summary": "2-3 sentences",
  "verdict": "bullish|bearish|neutral",
  "macro_headlines": ["..."],
  "risk_factors": ["..."],
  "upcoming_events": ["..."]
}}

Max 4 items per list. Use empty arrays when none apply."""
    data = await perplexity_sonar_json(
        prompt=prompt,
        search_recency_filter="week",
        cache_key=perplexity_cache_key("macro", sym),
    )
    if not data:
        return None
    summary = str(data.get("summary") or "").strip()
    if not summary:
        return None
    return PerplexityMacroEnrichment(
        symbol=sym,
        summary=summary[:600],
        verdict=str(data.get("verdict") or "neutral").strip().lower() or "neutral",
        macro_headlines=_normalize_str_list(data.get("macro_headlines")),
        risk_factors=_normalize_str_list(data.get("risk_factors")),
        upcoming_events=_normalize_str_list(data.get("upcoming_events")),
    )


def apply_perplexity_news_enrichment(
    news: NewsLayerResult,
    enrich: PerplexityNewsEnrichment,
    *,
    params_bullish_threshold: int,
    params_bearish_threshold: int,
) -> NewsLayerResult:
    """Adjust an existing news layer with Perplexity backfill (does not replace Benzinga)."""
    base = _sentiment_to_score(enrich.sentiment)
    if enrich.headwinds and enrich.sentiment == "neutral":
        base -= min(0.2, 0.05 * len(enrich.headwinds))
    if enrich.catalysts and enrich.sentiment == "neutral":
        base += min(0.2, 0.05 * len(enrich.catalysts))
    weighted = max(-1.0, min(1.0, float(news.weighted_sentiment or 0.0) + base))
    score = int(round((weighted + 1.0) / 2.0 * 100.0))
    if score >= params_bullish_threshold:
        verdict = "bullish"
    elif score <= params_bearish_threshold:
        verdict = "bearish"
    else:
        verdict = "neutral"

    chips = list(news.chips or [])
    chips = [c for c in chips if c != "No qualifying headlines"]
    chips.append("News: Perplexity backfill")
    if enrich.headwinds:
        chips.append(f"Headwind: {enrich.headwinds[0][:48]}")
    if enrich.catalysts:
        chips.append(f"Catalyst: {enrich.catalysts[0][:48]}")

    reasoning_parts = [enrich.summary]
    if enrich.headwinds:
        reasoning_parts.append("Headwinds: " + "; ".join(enrich.headwinds[:3]))
    if enrich.catalysts:
        reasoning_parts.append("Catalysts: " + "; ".join(enrich.catalysts[:3]))

    news.score = score
    news.verdict = verdict
    news.weighted_sentiment = weighted
    news.data_state = "perplexity_enriched"
    news.reasoning = " ".join(reasoning_parts)[:900]
    news.chips = chips
    if enrich.catalysts and not news.catalyst_headline:
        news.catalyst_headline = enrich.catalysts[0]
        news.catalyst_type = "macro"
    return news


def apply_perplexity_macro_enrichment(macro: MacroLayerResult, enrich: PerplexityMacroEnrichment) -> MacroLayerResult:
    delta = {"bullish": 6, "bearish": -6, "neutral": 0}.get(enrich.verdict, 0)
    if enrich.risk_factors:
        delta -= min(8, 2 * len(enrich.risk_factors))
    if enrich.macro_headlines and enrich.verdict == "bullish":
        delta += 2
    macro.score = int(max(0, min(100, int(macro.score or 50) + delta)))

    if macro.score >= 63:
        macro.verdict = "bullish"
    elif macro.score <= 45:
        macro.verdict = "bearish"
    else:
        macro.verdict = "neutral"

    chips = list(macro.chips or [])
    chips.append("Macro: Perplexity context")
    if enrich.upcoming_events:
        chips.append(f"Event watch: {enrich.upcoming_events[0][:40]}")
    macro.chips = chips

    warnings = list(macro.macro_warnings or [])
    for rf in enrich.risk_factors[:3]:
        if rf not in warnings:
            warnings.append(rf)
    macro.macro_warnings = warnings

    reasoning = str(macro.reasoning or "").strip()
    if enrich.summary:
        macro.reasoning = (reasoning + " " + enrich.summary).strip()[:900]

    upcoming = list(macro.upcoming_events or [])
    for ev in enrich.upcoming_events[:3]:
        upcoming.append({"name": ev, "status": "watch", "source": enrich.source})
    macro.upcoming_events = upcoming
    if enrich.risk_factors:
        macro.macro_risk_level = "moderate" if macro.macro_risk_level == "low" else macro.macro_risk_level
    return macro


async def maybe_apply_perplexity_layers(
    *,
    symbol: str,
    ticker_ref: TickerReference | None,
    news: NewsLayerResult,
    macro: MacroLayerResult,
    benzinga_data: BenzingaMultiResult | None,
    economic_event_count: int,
    news_bullish_threshold: int,
    news_bearish_threshold: int,
) -> tuple[NewsLayerResult, MacroLayerResult, PerplexityNewsEnrichment | None, PerplexityMacroEnrichment | None]:
    """Fetch and apply Perplexity backfill when Polygon/Benzinga layers are thin."""
    news_enrich: PerplexityNewsEnrichment | None = None
    macro_enrich: PerplexityMacroEnrichment | None = None

    if needs_perplexity_news(news, benzinga_data):
        news_enrich = await fetch_news_enrichment(symbol, ticker_ref)
        if news_enrich is not None:
            news = apply_perplexity_news_enrichment(
                news,
                news_enrich,
                params_bullish_threshold=news_bullish_threshold,
                params_bearish_threshold=news_bearish_threshold,
            )
            _LOG.info("perplexity_news_enriched symbol=%s sentiment=%s", symbol, news_enrich.sentiment)

    if needs_perplexity_macro(macro, ticker_ref=ticker_ref, economic_event_count=economic_event_count):
        macro_enrich = await fetch_macro_enrichment(symbol, ticker_ref)
        if macro_enrich is not None:
            macro = apply_perplexity_macro_enrichment(macro, macro_enrich)
            _LOG.info("perplexity_macro_enriched symbol=%s verdict=%s", symbol, macro_enrich.verdict)

    return news, macro, news_enrich, macro_enrich


def perplexity_risk_factor_lines(enrich: PerplexityNewsEnrichment | None) -> list[str]:
    if enrich is None:
        return []
    lines = [h for h in enrich.headwinds if h.strip()]
    return lines[:4]

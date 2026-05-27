"""Layer 2 — weighted sentiment from Polygon news rows (dicts)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from stocvest.api.services.news_quality_filter import is_quality_article
from stocvest.config.signal_parameters import NewsParameters
from stocvest.data.benzinga_client import BenzingaMultiResult
from stocvest.signals.analyst_rating_score import (
    analyst_firm_weight,
    blend_headline_and_analyst,
    compute_structured_analyst_score,
)
from stocvest.signals.news_copy import no_qualifying_news_reasoning
from stocvest.signals.news_sentiment import (
    DAY_NEWS_LOOKBACK_HOURS,
    SWING_NEWS_LOOKBACK_HOURS,
    swing_recency_weight,
)


@dataclass
class NewsLayerResult:
    status: str
    score: int | None
    verdict: str
    article_count: int = 0
    weighted_sentiment: float | None = None
    headline_sentiment: float | None = None
    analyst_sub_score: float | None = None
    catalyst_type: str | None = None
    catalyst_headline: str | None = None
    wim_summary: str | None = None
    data_state: str = "fresh"
    analyst_feed_state: str | None = None
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)
    latest_rating: dict[str, Any] | None = None
    latest_guidance: dict[str, Any] | None = None
    earnings_result: dict[str, Any] | None = None
    analyst_consensus: dict[str, Any] | None = None


_CATALYST_PATTERNS: dict[str, tuple[str, ...]] = {
    "earnings": ("earnings", "eps", "revenue", "beat", "miss", "guidance"),
    "analyst": ("upgrade", "downgrade", "price target", "raises", "cuts"),
    "fda": ("fda", "approval", "approved", "rejected", "clinical"),
    "merger": ("merger", "acquisition", "deal", "takeover", "buyout"),
    "macro": ("fed", "federal reserve", "rate", "inflation", "cpi", "gdp", "jobs"),
}


def _article_sentiment(article: dict[str, Any]) -> float:
    insights = article.get("insights")
    if isinstance(insights, list) and insights:
        first = insights[0]
        if isinstance(first, dict):
            s = str(first.get("sentiment") or "").lower()
            if s in ("positive", "bullish"):
                return 1.0
            if s in ("negative", "bearish"):
                return -1.0
    return 0.0


def _article_benzinga_weight(article: dict[str, Any]) -> float:
    raw = article.get("benzinga_weight")
    try:
        w = float(raw)
    except (TypeError, ValueError):
        return 1.0
    return max(0.05, min(2.0, w))


def _benzinga_layer_attachments(
    bz: BenzingaMultiResult | None,
    *,
    current_price: float | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    if bz is None:
        return None, None, None
    now = datetime.now(timezone.utc)

    lr: dict[str, Any] | None = None
    if bz.ratings:
        r = bz.ratings[0]
        if (now - r.published_at) <= timedelta(days=7):
            upside_pct: float | None = None
            if (
                current_price is not None
                and current_price > 0
                and r.price_target is not None
                and r.price_target > 0
            ):
                upside_pct = round(((r.price_target - current_price) / current_price) * 100.0, 1)
            lr = {
                "action": r.action,
                "rating": r.rating,
                "firm": r.analyst_firm,
                "date_str": r.published_at.date().isoformat(),
                "price_target": r.price_target,
                "upside_pct": upside_pct,
                "firm_tier": "tier_1" if analyst_firm_weight(r.analyst_firm) > 1.0 else "standard",
            }

    lg: dict[str, Any] | None = None
    if bz.guidance:
        g = bz.guidance[0]
        if (now - g.published_at) <= timedelta(days=14):
            lg = {"type": g.guidance_type, "headline": g.headline, "date_str": g.published_at.date().isoformat()}

    ee: dict[str, Any] | None = None
    if bz.earnings:
        e = bz.earnings[0]
        if (now - e.reported_at) <= timedelta(days=30):
            ee = {"beat": e.beat, "eps_surprise_pct": e.eps_surprise_pct, "period": e.period}
    return lr, lg, ee


def _fill_benzinga_fields(
    out: NewsLayerResult,
    bz: BenzingaMultiResult | None,
    *,
    current_price: float | None = None,
    analyst_consensus: dict[str, Any] | None = None,
    analyst_feed_state: str | None = None,
) -> NewsLayerResult:
    lr, lg, ee = _benzinga_layer_attachments(bz, current_price=current_price)
    out.latest_rating = lr
    out.latest_guidance = lg
    out.earnings_result = ee
    out.analyst_consensus = analyst_consensus
    if analyst_feed_state:
        out.analyst_feed_state = analyst_feed_state
    return out


def _detect_catalyst(title: str, desc: str) -> tuple[str | None, str | None]:
    blob = f"{title} {desc}".lower()
    for kind, keys in _CATALYST_PATTERNS.items():
        if any(k in blob for k in keys):
            return kind, title[:120] if title else None
    return None, None


class NewsAnalyzer:
    def analyze(
        self,
        symbol: str,
        articles: list[dict[str, Any]],
        params: NewsParameters,
        *,
        lookback_hours: int | None = None,
        mode: Literal["day", "swing"] = "day",
        benzinga_data: BenzingaMultiResult | None = None,
        current_price: float | None = None,
    ) -> NewsLayerResult:
        sym = symbol.upper().strip()
        now = datetime.now(timezone.utc)
        if lookback_hours is not None:
            lb_h = float(lookback_hours)
        elif mode == "swing":
            lb_h = float(SWING_NEWS_LOOKBACK_HOURS)
        else:
            lb_h = float(params.lookback_hours if params.lookback_hours else DAY_NEWS_LOOKBACK_HOURS)
        cutoff = now - timedelta(hours=lb_h)
        raw_rows = [a for a in articles if isinstance(a, dict)]
        time_filtered: list[dict[str, Any]] = []
        for a in raw_rows:
            pub_raw = a.get("published_utc")
            try:
                pub = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                time_filtered.append(a)
                continue
            if pub.astimezone(timezone.utc) >= cutoff:
                time_filtered.append(a)
        rows = time_filtered[: params.max_articles]
        quality = [a for a in rows if is_quality_article(a)]

        structured = compute_structured_analyst_score(
            benzinga_data, mode=mode, current_price=current_price, now=now
        )
        analyst_feed_state = structured.feed_state
        analyst_active = structured.feed_state == "available" and (
            structured.score != 0.0 or structured.consensus is not None
        )

        if not quality:
            headline_avg = 0.0
            catalyst_type_extra, event_adjust, analyst_consensus, analyst_chips = self._benzinga_event_adjustment(
                benzinga_data, mode=mode, now=now, structured=structured
            )
            weighted_avg = blend_headline_and_analyst(
                headline_avg,
                structured.score,
                mode=mode,
                analyst_active=analyst_active,
            )
            weighted_avg = max(-1.0, min(1.0, weighted_avg + event_adjust))
            score = int(round((weighted_avg + 1) / 2 * 100))

            if score >= params.bullish_threshold:
                verdict = "bullish"
            elif score <= params.bearish_threshold:
                verdict = "bearish"
            else:
                verdict = "neutral"

            chips = ["News: neutral", "No qualifying headlines"]
            if analyst_feed_state == "unconfigured":
                chips.append("Analyst feed unavailable")
            chips.extend(analyst_chips)
            if analyst_active and structured.score != 0.0:
                chips.append(f"analyst {structured.score:+.2f}")

            data_state = "stale"
            if analyst_active and score != 50:
                data_state = "fresh"

            return _fill_benzinga_fields(
                NewsLayerResult(
                    status="available",
                    score=score,
                    verdict=verdict,
                    article_count=0,
                    weighted_sentiment=weighted_avg,
                    headline_sentiment=headline_avg,
                    analyst_sub_score=structured.score if analyst_active else None,
                    catalyst_type=catalyst_type_extra,
                    wim_summary=(benzinga_data.wim.reason if benzinga_data and benzinga_data.wim else None),
                    data_state=data_state,
                    analyst_feed_state=analyst_feed_state,
                    reasoning=no_qualifying_news_reasoning(sym),
                    chips=chips,
                ),
                benzinga_data,
                current_price=current_price,
                analyst_consensus=analyst_consensus,
                analyst_feed_state=analyst_feed_state,
            )

        weights: list[float] = []
        sentiments: list[float] = []
        catalyst_type: str | None = None
        catalyst_headline: str | None = None

        for art in quality:
            title = str(art.get("title") or "")
            desc = str(art.get("description") or "")
            ct, ch_head = _detect_catalyst(title, desc)
            if ct and catalyst_type is None:
                catalyst_type = ct
                catalyst_headline = ch_head

            sent = _article_sentiment(art)
            pub_raw = art.get("published_utc")
            try:
                pub = datetime.fromisoformat(str(pub_raw).replace("Z", "+00:00"))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                pub = now
            age_sec = max(0.0, (now - pub.astimezone(timezone.utc)).total_seconds())
            age_h = age_sec / 3600.0
            if age_h < 1:
                w_time = params.recency_1h_weight
            elif age_h < 4:
                w_time = params.recency_4h_weight
            elif age_h < 8:
                w_time = params.recency_8h_weight
            else:
                w_time = params.recency_old_weight

            tickers = art.get("tickers")
            tset = {str(t).strip().upper() for t in tickers} if isinstance(tickers, list) else set()
            rel = params.direct_mention_weight if sym in tset else params.indirect_mention_weight
            combined = w_time * rel * _article_benzinga_weight(art)
            if mode == "swing":
                combined *= swing_recency_weight(pub.astimezone(timezone.utc), now)
            weights.append(combined)
            sentiments.append(sent)

        wsum = sum(weights)
        if wsum <= 0:
            return _fill_benzinga_fields(
                NewsLayerResult(
                    status="available",
                    score=50,
                    verdict="neutral",
                    article_count=len(quality),
                    weighted_sentiment=0.0,
                    headline_sentiment=0.0,
                    wim_summary=(benzinga_data.wim.reason if benzinga_data and benzinga_data.wim else None),
                    data_state="stale",
                    analyst_feed_state=analyst_feed_state,
                    reasoning="No dominant catalyst in current lookback; sentiment baseline remains neutral.",
                    chips=["News: neutral", "Weights collapsed"],
                ),
                benzinga_data,
                current_price=current_price,
                analyst_feed_state=analyst_feed_state,
            )

        headline_avg = sum(s * w for s, w in zip(sentiments, weights)) / wsum
        catalyst_type_extra, event_adjust, analyst_consensus, analyst_chips = self._benzinga_event_adjustment(
            benzinga_data, mode=mode, now=now, structured=structured
        )
        if catalyst_type_extra:
            catalyst_type = catalyst_type_extra

        weighted_avg = blend_headline_and_analyst(
            headline_avg,
            structured.score,
            mode=mode,
            analyst_active=analyst_active,
        )
        weighted_avg = max(-1.0, min(1.0, weighted_avg + event_adjust))
        score = int(round((weighted_avg + 1) / 2 * 100))

        if score >= params.bullish_threshold:
            verdict = "bullish"
        elif score <= params.bearish_threshold:
            verdict = "bearish"
        else:
            verdict = "neutral"

        chips = [f"{len(quality)} articles", f"sent_avg {weighted_avg:+.2f}"]
        if analyst_active:
            chips.append(f"headline {headline_avg:+.2f} · analyst {structured.score:+.2f}")
        if catalyst_type:
            chips.append(f"Catalyst: {catalyst_type}")
        if benzinga_data and benzinga_data.wim:
            chips.append("WIM context")
        if analyst_feed_state == "unconfigured":
            chips.append("Analyst feed unavailable")
        chips.extend(analyst_chips)

        return _fill_benzinga_fields(
            NewsLayerResult(
                status="available",
                score=score,
                verdict=verdict,
                article_count=len(quality),
                weighted_sentiment=weighted_avg,
                headline_sentiment=headline_avg,
                analyst_sub_score=structured.score if analyst_active else None,
                catalyst_type=catalyst_type,
                catalyst_headline=catalyst_headline,
                wim_summary=(benzinga_data.wim.reason if benzinga_data and benzinga_data.wim else None),
                data_state="fresh",
                analyst_feed_state=analyst_feed_state,
                reasoning=(
                    f"News score {score}/100 from {len(quality)} quality articles "
                    f"(blended sentiment {weighted_avg:+.2f}; "
                    f"headline {headline_avg:+.2f}, analyst {structured.score:+.2f})."
                ),
                chips=chips,
            ),
            benzinga_data,
            current_price=current_price,
            analyst_consensus=analyst_consensus,
            analyst_feed_state=analyst_feed_state,
        )

    def _benzinga_event_adjustment(
        self,
        bz: BenzingaMultiResult | None,
        *,
        mode: Literal["day", "swing"],
        now: datetime,
        structured: Any,
    ) -> tuple[str | None, float, dict[str, Any] | None, list[str]]:
        """Guidance/earnings nudges plus structured analyst metadata (score blended separately)."""
        if bz is None:
            return None, 0.0, None, []

        catalyst: str | None = structured.catalyst
        adjust = 0.0
        analyst_chips: list[str] = list(structured.chips)
        analyst_consensus = structured.consensus

        if bz.guidance:
            latest_g = bz.guidance[0]
            if (now - latest_g.published_at) <= timedelta(days=14):
                g = latest_g.guidance_type.lower()
                if g == "raised":
                    adjust += 0.20
                    catalyst = "guidance_raise"
                elif g == "lowered":
                    adjust -= 0.20
                    catalyst = "guidance_cut"

        if bz.earnings:
            latest_e = bz.earnings[0]
            if (now - latest_e.reported_at) <= timedelta(days=30):
                if latest_e.beat is True:
                    adjust += 0.25
                    catalyst = "earnings_beat"
                elif latest_e.beat is False:
                    adjust -= 0.25
                    catalyst = "earnings_miss"

        return catalyst, adjust, analyst_consensus, analyst_chips

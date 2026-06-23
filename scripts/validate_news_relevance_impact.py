"""Research validation (read-only): does weighting News by relevance x impact x age
improve forward-return prediction over the current flat-sentiment average?

Motivation: the live News layer averages per-article polarity (+-1) weighted only by
recency x mention x source. A single low-relevance, low-impact, stale headline (e.g. a
"In 10 years will you wish you'd bought X?" listicle) therefore prints an extreme score.
The proposed model multiplies each article's weight by:
    relevance (credible, on-topic source)  x  impact (market-moving catalyst type)
and shrinks the score toward neutral (50) when the total effective weight is small.

This script tests that hypothesis CHEAPLY using HEURISTIC proxies we already ship:
    relevance proxy = publisher credibility rank (news_relevance.publisher_credibility_rank)
    impact proxy    = catalyst-type magnitude (news_relevance.CATALYST_SCORES, first match)
    age             = existing swing recency decay
If even these crude proxies separate winners from losers (and correctly NEUTRALIZE the
noise the flat score acts on), a Claude-grade relevance/impact estimator is worth building.
It does NOT modify scoring. No lookahead. No API spend beyond Polygon news/bars.

Run:  python scripts/validate_news_relevance_impact.py
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from statistics import mean

from stocvest.api.services.news_quality_filter import is_quality_article
from stocvest.api.services.news_relevance import CATALYST_SCORES, publisher_credibility_rank
from stocvest.api.services.polygon_insight_sentiment import article_sentiment_score_for_symbol
from stocvest.config.signal_parameters import NewsParameters
from stocvest.data.models import Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.news_analyzer import _article_benzinga_weight
from stocvest.signals.news_ipo_narrative import classify_ipo_narrative_adjustment
from stocvest.signals.news_sentiment import SWING_NEWS_LOOKBACK_HOURS, swing_recency_weight
from stocvest.utils.config import get_settings

logging.disable(logging.CRITICAL)

UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "NFLX", "AMD", "INTC",
    "MU", "AVGO", "QCOM", "CRM", "ADBE", "ORCL", "CSCO", "IBM", "TXN", "MRVL",
    "JPM", "BAC", "GS", "WFC", "C", "MS",
    "XOM", "CVX", "COP", "SLB", "OXY",
    "JNJ", "PFE", "MRK", "UNH", "ABBV", "LLY", "BMY",
    "PG", "KO", "PEP", "WMT", "COST", "MCD",
    "DIS", "NKE", "SBUX", "HD", "LOW",
    "BA", "CAT", "GE", "HON", "DE",
    "T", "VZ", "DAL", "UAL", "CVS", "PYPL", "SHOP", "UBER", "F", "GM",
    "NEE", "DUK", "SO", "PLTR", "COIN", "SQ", "RIVN", "LCID",
]

PARAMS = NewsParameters()
LB_HOURS = float(SWING_NEWS_LOOKBACK_HOURS)
SAMPLE_STRIDE = 3
NEWS_HISTORY_DAYS = 360
MAX_CATALYST_PTS = max(CATALYST_SCORES.values())  # 40 (earnings)
CONF_K = 0.6           # total effective weight at which RI confidence saturates
CLAMP = lambda x: max(-1.0, min(1.0, x))  # noqa: E731


def _recency_weight(age_h: float) -> float:
    if age_h < 1:
        return PARAMS.recency_1h_weight
    if age_h < 4:
        return PARAMS.recency_4h_weight
    if age_h < 8:
        return PARAMS.recency_8h_weight
    return PARAMS.recency_old_weight


def _catalyst_pts(title: str, desc: str) -> int:
    blob = f"{title} {desc}".lower()
    for keywords, pts in CATALYST_SCORES.items():
        if any(kw in blob for kw in keywords):
            return pts
    return 0


def _impact_factor(pts: int) -> float:
    # 0.25 floor (generic headline still counts a little) -> 1.0 (top catalyst).
    return 0.25 + 0.75 * (pts / MAX_CATALYST_PTS)


def _relevance_factor(cred_rank: int) -> float:
    # 0.35 floor (unknown source) -> 1.0 (top-tier outlet). cred_rank in ~0..20.
    return 0.35 + 0.65 * min(1.0, cred_rank / 20.0)


def _publisher_name(row: dict) -> str:
    pub = row.get("publisher")
    if isinstance(pub, dict):
        return str(pub.get("name") or "")
    return str(row.get("source") or "")


def _parse_pub(row: dict) -> datetime | None:
    raw = row.get("published_utc")
    try:
        pub = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    return pub.astimezone(timezone.utc)


def _prep_news(rows: list[dict], sym: str) -> list[dict]:
    out: list[dict] = []
    for r in rows:
        if not isinstance(r, dict) or not is_quality_article(r):
            continue
        pub = _parse_pub(r)
        if pub is None:
            continue
        tickers = r.get("tickers")
        tset = {str(t).strip().upper() for t in tickers} if isinstance(tickers, list) else set()
        title = str(r.get("title") or "")
        desc = str(r.get("description") or "")
        ipo = classify_ipo_narrative_adjustment(sym, title, desc)
        pts = _catalyst_pts(title, desc)
        out.append(
            {
                "_pub": pub,
                "_sent": article_sentiment_score_for_symbol(r, sym),
                "_direct": sym in tset,
                "_bw": _article_benzinga_weight(r),
                "_ipo": ipo.weight_multiplier,
                "_impact": _impact_factor(pts),
                "_rel": _relevance_factor(publisher_credibility_rank(_publisher_name(r))),
            }
        )
    return out


def _scores_as_of(arts: list[dict], t: datetime) -> tuple[int, int, float] | None:
    """Return (flat_score, ri_score, ri_total_weight) as-of t, or None if no news in window."""
    cutoff = t - timedelta(hours=LB_HOURS)
    base_w: list[float] = []
    ri_w: list[float] = []
    sents: list[float] = []
    for a in arts:
        pub = a["_pub"]
        if pub <= cutoff or pub > t:
            continue
        age_h = max(0.0, (t - pub).total_seconds() / 3600.0)
        rel_mention = PARAMS.direct_mention_weight if a["_direct"] else PARAMS.indirect_mention_weight
        base = _recency_weight(age_h) * rel_mention * a["_bw"] * swing_recency_weight(pub, t) * a["_ipo"]
        if base <= 0:
            continue
        base_w.append(base)
        ri_w.append(base * a["_impact"] * a["_rel"])
        sents.append(a["_sent"])
    if not base_w:
        return None
    flat_avg = sum(s * w for s, w in zip(sents, base_w)) / sum(base_w)
    flat_score = int(round((CLAMP(flat_avg) + 1) / 2 * 100))
    ri_sum = sum(ri_w)
    if ri_sum <= 0:
        return flat_score, 50, 0.0
    ri_avg = sum(s * w for s, w in zip(sents, ri_w)) / ri_sum
    raw_ri = (CLAMP(ri_avg) + 1) / 2 * 100
    conf = min(1.0, ri_sum / CONF_K)
    ri_score = int(round(50 + (raw_ri - 50) * conf))
    return flat_score, ri_score, ri_sum


async def _fetch(sym: str, sem: asyncio.Semaphore, client: PolygonClient):
    async with sem:
        try:
            bars = await client.get_bars(sym, Timeframe.DAY_1, limit=420)
        except Exception:
            bars = []
        try:
            gte = datetime.now(timezone.utc) - timedelta(days=NEWS_HISTORY_DAYS)
            news = await client.get_market_news(tickers=[sym], limit=1000, published_utc_gte=gte)
        except Exception:
            news = []
        return sym, bars, news


def pct(xs) -> float:
    return 100.0 * sum(1 for x in xs if x > 0) / len(xs) if xs else float("nan")


def _dir(score: int) -> int:
    return 1 if score >= 60 else (-1 if score <= 40 else 0)


async def main() -> None:
    s = get_settings()
    sem = asyncio.Semaphore(8)
    async with PolygonClient(api_key=s.polygon_api_key) as client:
        results = await asyncio.gather(*(_fetch(sym, sem, client) for sym in UNIVERSE))

    # rows: (flat, ri, fwd10)
    rows: list[tuple[int, int, float]] = []
    for sym, bars, news in results:
        if len(bars) < 40 or not news:
            continue
        arts = _prep_news(news, sym)
        if not arts:
            continue
        closes = [b.close for b in bars]
        for i in range(0, len(closes) - 10, SAMPLE_STRIDE):
            t = bars[i].timestamp
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            t = t.astimezone(timezone.utc).replace(hour=21, minute=0, second=0, microsecond=0)
            sc = _scores_as_of(arts, t)
            if sc is None:
                continue
            flat, ri, _w = sc
            fwd10 = closes[i + 10] / closes[i] - 1.0
            rows.append((flat, ri, fwd10))

    print(f"news-day cases: {len(rows)}\n")
    if len(rows) < 50:
        print("Too few cases; widen NEWS_HISTORY_DAYS/universe.")
        return

    def edge_stats(label: str, picks: list[tuple[int, float]]):
        """picks = list of (direction, fwd10)."""
        directional = [(d, f) for d, f in picks if d != 0]
        if not directional:
            print(f"  {label:46} calls=0")
            return
        signed = [d * f for d, f in directional]
        print(f"  {label:46} calls={len(directional):4d}  edge10={mean(signed)*100:+.2f}%  hit10={pct(signed):.0f}%")

    print("Directional EDGE per scorer (edge = forward 10d return in the call's direction):")
    edge_stats("FLAT score (current production)", [(_dir(f), fwd) for f, r, fwd in rows])
    edge_stats("RELEVANCE x IMPACT x AGE score (proposed)", [(_dir(r), fwd) for f, r, fwd in rows])
    print()

    # The decisive test: articles the FLAT score calls directional but RI neutralizes.
    flat_dir = [(f, r, fwd) for f, r, fwd in rows if _dir(f) != 0]
    ri_kept = [(f, r, fwd) for f, r, fwd in flat_dir if _dir(r) != 0]
    ri_killed = [(f, r, fwd) for f, r, fwd in flat_dir if _dir(r) == 0]
    print(f"Of {len(flat_dir)} FLAT directional calls: RI keeps {len(ri_kept)}, neutralizes {len(ri_killed)}.")
    print("If RI is filtering NOISE, the neutralized set should have ~0 edge while kept set is stronger:")
    edge_stats("  FLAT calls RI KEPT", [(_dir(f), fwd) for f, r, fwd in ri_kept])
    edge_stats("  FLAT calls RI NEUTRALIZED (dropped)", [(_dir(f), fwd) for f, r, fwd in ri_killed])
    print()

    # Extreme-score behavior: does RI tame the 100/0 prints the flat score makes?
    flat_extreme = [(f, r) for f, r, _ in rows if f >= 90 or f <= 10]
    if flat_extreme:
        tamed = [1 for f, r in flat_extreme if 10 < r < 90]
        print(f"FLAT extreme prints (>=90 or <=10): {len(flat_extreme)} | RI pulls inside 10-90: "
              f"{sum(tamed)} ({100.0*sum(tamed)/len(flat_extreme):.0f}%)")


if __name__ == "__main__":
    asyncio.run(main())

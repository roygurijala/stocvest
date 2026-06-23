"""Research validation (read-only) for a candidate News-layer coverage/recency haircut.

Question: the News layer score is a pure sentiment->score map
    score = (weighted_avg + 1) / 2 * 100
where weighted_avg is the *weighted average* of per-article sentiment. Because the
recency/relevance weights cancel in an average, a SINGLE +1.0 (Polygon "bullish")
headline -> weighted_avg +1.0 -> score 100, no matter how thin or stale the coverage.

Does that extreme single-article confidence actually earn its keep? I.e., is a
directional News score from *thin* coverage as predictive of the forward move as the
same score from *thick* coverage? If thin coverage is materially weaker, then shrinking
the score toward neutral (50) when articles are few/old improves accuracy.

This does NOT modify scoring. It reconstructs the production headline-score path
as-of each historical date (no lookahead, no analyst/Benzinga events — the exact
situation the user flagged) and joins it to realized forward returns.

Run:  python scripts/validate_news_coverage_confidence.py
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from statistics import mean

from stocvest.api.services.news_quality_filter import is_quality_article
from stocvest.api.services.polygon_insight_sentiment import article_sentiment_score_for_symbol
from stocvest.config.signal_parameters import NewsParameters
from stocvest.data.models import Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.news_analyzer import _article_benzinga_weight
from stocvest.signals.news_ipo_narrative import classify_ipo_narrative_adjustment
from stocvest.signals.news_sentiment import SWING_NEWS_LOOKBACK_HOURS, swing_recency_weight
from stocvest.utils.config import get_settings

logging.disable(logging.CRITICAL)

# News-rich, liquid names across sectors (enough headline flow to populate windows).
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
SAMPLE_STRIDE = 3          # eval every Nth bar to reduce overlapping-window autocorrelation
NEWS_HISTORY_DAYS = 360    # how far back to pull headlines
CLAMP = lambda x: max(-1.0, min(1.0, x))  # noqa: E731


def _recency_weight(age_h: float) -> float:
    if age_h < 1:
        return PARAMS.recency_1h_weight
    if age_h < 4:
        return PARAMS.recency_4h_weight
    if age_h < 8:
        return PARAMS.recency_8h_weight
    return PARAMS.recency_old_weight


def _parse_pub(row: dict) -> datetime | None:
    raw = row.get("published_utc")
    try:
        pub = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    return pub.astimezone(timezone.utc)


def _news_score_as_of(arts: list[dict], sym: str, t: datetime) -> tuple[int, int, float] | None:
    """Reconstruct the production headline score as-of ``t`` (no analyst/event terms).

    Returns (score, n_quality_in_window, freshest_age_h) or None when no quality news.
    """
    cutoff = t - timedelta(hours=LB_HOURS)
    weights: list[float] = []
    sentiments: list[float] = []
    ages: list[float] = []
    for a in arts:
        pub = a.get("_pub")
        if pub is None or pub <= cutoff or pub > t:
            continue
        sent = a.get("_sent", 0.0)
        age_h = max(0.0, (t - pub).total_seconds() / 3600.0)
        rel = PARAMS.direct_mention_weight if a.get("_direct") else PARAMS.indirect_mention_weight
        combined = _recency_weight(age_h) * rel * a.get("_bw", 1.0)
        combined *= swing_recency_weight(pub, t)
        combined *= a.get("_ipo", 1.0)
        if combined <= 0:
            continue
        weights.append(combined)
        sentiments.append(sent)
        ages.append(age_h)
    wsum = sum(weights)
    if wsum <= 0 or not weights:
        return None
    headline_avg = sum(s * w for s, w in zip(sentiments, weights)) / wsum
    score = int(round((CLAMP(headline_avg) + 1) / 2 * 100))
    return score, len(weights), min(ages)


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
        ipo = classify_ipo_narrative_adjustment(
            sym, str(r.get("title") or ""), str(r.get("description") or "")
        )
        out.append(
            {
                "_pub": pub,
                "_sent": article_sentiment_score_for_symbol(r, sym),
                "_direct": sym in tset,
                "_bw": _article_benzinga_weight(r),
                "_ipo": ipo.weight_multiplier,
            }
        )
    return out


def pct(xs) -> float:
    return 100.0 * sum(1 for x in xs if x > 0) / len(xs) if xs else float("nan")


async def main() -> None:
    s = get_settings()
    sem = asyncio.Semaphore(8)
    async with PolygonClient(api_key=s.polygon_api_key) as client:
        results = await asyncio.gather(*(_fetch(sym, sem, client) for sym in UNIVERSE))

    # rows: (sym, date, score, n, freshest_age_h, fwd5, fwd10)
    rows: list[tuple] = []
    syms_with_news = 0
    for sym, bars, news in results:
        if len(bars) < 40 or not news:
            continue
        arts = _prep_news(news, sym)
        if not arts:
            continue
        syms_with_news += 1
        closes = [b.close for b in bars]
        for i in range(0, len(closes) - 10, SAMPLE_STRIDE):
            t = bars[i].timestamp
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            # Evaluate post-close so same-day headlines are in-window without lookahead.
            t = t.astimezone(timezone.utc).replace(hour=21, minute=0, second=0, microsecond=0)
            res = _news_score_as_of(arts, sym, t)
            if res is None:
                continue
            score, n, fresh = res
            fwd5 = closes[i + 5] / closes[i] - 1.0
            fwd10 = closes[i + 10] / closes[i] - 1.0
            rows.append((sym, bars[i].timestamp.date(), score, n, fresh, fwd5, fwd10))

    print(f"Universe {len(UNIVERSE)} | symbols with quality news {syms_with_news} | news-day cases {len(rows)}\n")
    if len(rows) < 50:
        print("Too few cases to draw conclusions (Polygon news history likely shallow). "
              "Increase NEWS_HISTORY_DAYS / universe or use Benzinga replay.")
        if not rows:
            return

    # Directional cases only: the score is making a call (>=60 bullish, <=40 bearish).
    directional = [r for r in rows if r[2] >= 60 or r[2] <= 40]
    print(f"Directional cases (score>=60 or <=40): {len(directional)} "
          f"({100.0*len(directional)/max(1,len(rows)):.0f}% of news-days)\n")

    def signed_edge(r):
        # forward return in the direction the score points (bullish -> +fwd, bearish -> -fwd)
        d = 1.0 if r[2] >= 60 else -1.0
        return d * r[5], d * r[6]  # (fwd5_signed, fwd10_signed)

    def bucket(name, sub):
        if not sub:
            print(f"  {name:38} n=0")
            return
        e5 = [signed_edge(r)[0] for r in sub]
        e10 = [signed_edge(r)[1] for r in sub]
        print(f"  {name:38} n={len(sub):4d}  edge5={mean(e5)*100:+.2f}%  "
              f"edge10={mean(e10)*100:+.2f}%  hit10={pct(e10):.0f}%")

    print("Coverage depth vs DIRECTIONAL edge (edge = forward return in the signal's direction):")
    bucket("1 article", [r for r in directional if r[3] == 1])
    bucket("2-3 articles", [r for r in directional if 2 <= r[3] <= 3])
    bucket("4-6 articles", [r for r in directional if 4 <= r[3] <= 6])
    bucket("7+ articles", [r for r in directional if r[3] >= 7])
    print()
    print("Recency of freshest in-window article vs DIRECTIONAL edge:")
    bucket("freshest < 24h", [r for r in directional if r[4] < 24])
    bucket("freshest 24-72h", [r for r in directional if 24 <= r[4] < 72])
    bucket("freshest >= 72h (stale)", [r for r in directional if r[4] >= 72])
    print()
    print("The flagged case — thin AND stale vs thick AND fresh:")
    bucket("1 article & >=48h old", [r for r in directional if r[3] == 1 and r[4] >= 48])
    bucket(">=4 articles & <24h", [r for r in directional if r[3] >= 4 and r[4] < 24])
    print()
    # How often does thin coverage produce an EXTREME score (the 100/0 problem)?
    n1 = [r for r in rows if r[3] == 1]
    extreme1 = [r for r in n1 if r[2] >= 90 or r[2] <= 10]
    if n1:
        print(f"Single-article news-days: {len(n1)} | of those, score>=90 or <=10 (near-max): "
              f"{len(extreme1)} ({100.0*len(extreme1)/len(n1):.0f}%)")


if __name__ == "__main__":
    asyncio.run(main())

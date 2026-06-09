"""
Gap intelligence: merge pre-market gap candidates with news catalyst context.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.data.earnings_catalyst import match_earnings_catalyst
from stocvest.data.earnings_calendar_fetch import index_earnings_by_symbol
from stocvest.data.market_context_flags import gap_item_market_context_warning, resolve_market_context_flags
from stocvest.data.models import EarningsEvent, NewsArticle, Snapshot
from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.news_catalyst_detector import NewsCatalystCandidate, NewsCatalystDetector
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

NO_CATALYST_WARNING = (
    "No catalyst found — momentum gap only. Price-only gaps carry higher reversal risk."
)

SECONDARY_SHARED_CATALYST_HEADLINE = "Referenced in related news — see primary ticker"

# Gap intelligence quality: four additive components (interpretable swing-style blend).
_GAP_MAX = 40.0
_GAP_SCALE = 11.0  # ~|gap|/scale; ~10% → mid-20s gap pts, large gaps saturate toward _GAP_MAX
_VOL_MAX = 20.0
_PRICE_MAX = 10.0
_PRICE_THRESHOLD = 20.0  # soft liquidity floor; full price pts at this price and above
_CATALYST_MAX = 30.0  # type band × narrative; sums with above to 100 at ceiling


def _catalyst_component(
    has_catalyst: bool,
    catalyst_type: str | None,
    narrative_score: int | None,
    sentiment_label: str | None,
) -> float:
    """
    Narrative-weighted catalyst points (0–_CATALYST_MAX).

    Bands follow swing hold-through intuition: earnings / structural > insider-ish >
    M&A uncertainty > analyst > macro / weak.
    ``narrative_score`` (0–100 from the detector) interpolates within each type's band.
    """
    if not has_catalyst:
        return 0.0
    t = (float(narrative_score) if narrative_score is not None else 55.0) / 100.0
    t = max(0.0, min(1.0, t))
    ct = (catalyst_type or "").strip().lower()
    sent = (sentiment_label or "").strip().lower()

    if ct == "earnings":
        if sent == "bearish":
            lo, hi = 22.0, _CATALYST_MAX  # miss, guide cut, structural downside
        else:
            lo, hi = 14.0, 24.0  # beat / mixed — still tradable but not max structural weight
    elif ct == "insider":
        lo, hi = 14.0, 22.0  # regulatory / Form 4 adjacent
    elif ct == "merger":
        lo, hi = 11.0, 20.0  # M&A rumor / deal uncertainty
    elif ct == "analyst":
        lo, hi = 9.0, 18.0
    elif ct == "macro":
        lo, hi = 5.0, 11.0  # secondary / tape-level
    else:
        lo, hi = 2.0, 9.0  # weak / incidental / unknown category

    return lo + t * (hi - lo)


def calculate_gap_quality_score(
    gap_pct: float,
    volume_vs_avg: float,
    has_catalyst: bool,
    price: float,
    *,
    catalyst_narrative_score: int | None = None,
    catalyst_type: str | None = None,
    catalyst_sentiment: str | None = None,
    cap_volume_for_mechanical_flow: bool = False,
) -> int:
    """
    Scanner gap quality: smooth saturating gap + volume, soft price liquidity, type-weighted catalyst.

    Components (each bounded, sum clamped 0–100):

    1. Gap magnitude: ``_GAP_MAX * (1 - exp(-|gap_pct| / _GAP_SCALE))``.
    2. Volume vs prior session: ``_VOL_MAX * (1 - exp(-max(0, vol_ratio - 1)))``.
    3. Price: ``_PRICE_MAX * min(1, price / _PRICE_THRESHOLD)`` (scanner already drops price < 5).
    4. Catalyst: band by ``catalyst_type`` + sentiment for earnings; width from narrative score.

    Pass ``catalyst_type`` and ``catalyst_sentiment`` from ``NewsCatalystCandidate`` when present.
    """
    ag = abs(float(gap_pct))
    vv = max(0.0, float(volume_vs_avg))
    px = float(price)

    gap_pts = _GAP_MAX * (1.0 - math.exp(-ag / _GAP_SCALE))

    excess_vol = max(0.0, vv - 1.0)
    vol_pts = _VOL_MAX * (1.0 - math.exp(-excess_vol))
    if cap_volume_for_mechanical_flow:
        # IPO / index-flow windows: note volume but do not treat it as full conviction.
        vol_pts = min(vol_pts, _VOL_MAX * 0.4)

    if px < 5.0:
        price_pts = 0.0
    else:
        price_pts = _PRICE_MAX * min(1.0, px / _PRICE_THRESHOLD)

    cat_pts = _catalyst_component(
        has_catalyst, catalyst_type, catalyst_narrative_score, catalyst_sentiment
    )

    raw = gap_pts + vol_pts + cat_pts + price_pts
    return int(max(0, min(100, round(raw))))


def _volume_vs_adv(day_volume: float, prev_day_volume: float | None) -> float:
    if prev_day_volume is not None and prev_day_volume > 0:
        return day_volume / float(prev_day_volume)
    return 1.0


# ---------------------------------------------------------------------------
# B30 Phase 4 — mode-fit classifier for gap cards
# ---------------------------------------------------------------------------
#
# A pre-market gap is mode-agnostic data (a 4% gap is a market event, not a
# trade plan), but a user clicking "View Signal" on the gap card on the
# scanner expects the modal to evaluate the gap through ONE engine — and the
# right engine depends on the gap's character. A 7% gap on bearish earnings is
# a swing-engine question (multi-day continuation thesis, gaps of this scale
# rarely round-trip intraday). A 2.5% gap with heavy premarket volume and no
# catalyst is a day-engine question (intraday volatility play, the news layer
# has no fundamental anchor to read).
#
# `classify_mode_best_fit` is the heuristic the gap card shows as a "Best
# evaluated as: <mode>" tag AND drives the on-click engine selection in the
# scanner's `Both` view. The classifier is intentionally transparent — it
# returns a list of reasoning chips so the user can audit the classification
# rather than treating it as a black box.
#
# It is **advisory, not authoritative**: when the user is in an explicit
# `scannerSetupMode === "swing"` or `"day"` view, the explicit mode wins —
# this tag only kicks in when the user is in the `Both` view and the mode
# has to be inferred per row.

# Reasoning chip prefixes (kept as constants so tests and UI can pin them).
_SWING_CHIP_STRUCTURAL_CATALYST = "structural catalyst"
_SWING_CHIP_LARGE_GAP = "large gap"
_SWING_CHIP_HIGH_CONVICTION = "high-conviction catalyst"

_DAY_CHIP_HEAVY_VOLUME = "heavy volume"
_DAY_CHIP_INTRADAY_RANGE = "tradable intraday range"
_DAY_CHIP_MOMENTUM_ONLY = "momentum gap (no fundamental anchor)"
_DAY_CHIP_TAPE_CATALYST = "tape-level catalyst"

# Closed-set return values (kept as a module-level constant so tests can pin
# the lock-in that the classifier never emits anything else).
MODE_BEST_FIT_VALUES: tuple[str, ...] = ("swing", "day", "either")


def _swing_signals(
    *,
    abs_gap: float,
    has_catalyst: bool,
    catalyst_category: str | None,
    catalyst_narrative_score: int | None,
) -> list[str]:
    """Enumerate the swing-tilt reasoning chips for one gap.

    Swing-tilt patterns share one property: the gap reflects information the
    market needs more than one session to fully digest. Earnings, M&A, and
    insider activity are the canonical examples — the price discovery process
    extends past the intraday session, so a swing hold benefits from the
    sustained narrative reaction.
    """
    out: list[str] = []
    cc = (catalyst_category or "").strip().lower()
    if has_catalyst and cc in ("earnings", "merger", "insider"):
        out.append(f"{_SWING_CHIP_STRUCTURAL_CATALYST} ({cc})")
    if abs_gap >= 3.0:
        out.append(f"{_SWING_CHIP_LARGE_GAP} ({abs_gap:.1f}%)")
    if has_catalyst and (catalyst_narrative_score or 0) >= 60:
        out.append(_SWING_CHIP_HIGH_CONVICTION)
    return out


def _day_signals(
    *,
    abs_gap: float,
    volume_vs_avg: float,
    has_catalyst: bool,
    catalyst_category: str | None,
) -> list[str]:
    """Enumerate the day-tilt reasoning chips for one gap.

    Day-tilt patterns share one property: the gap is more about flow than
    information. Heavy participation, a tradable-not-extreme range, and the
    absence of a fundamental anchor (or only a macro/analyst anchor that tends
    to fade intraday) all point to an intraday-engine question.
    """
    out: list[str] = []
    cc = (catalyst_category or "").strip().lower()
    if volume_vs_avg >= 2.0:
        out.append(f"{_DAY_CHIP_HEAVY_VOLUME} ({volume_vs_avg:.1f}\u00d7 avg)")
    if 1.5 <= abs_gap < 5.0:
        out.append(f"{_DAY_CHIP_INTRADAY_RANGE} ({abs_gap:.1f}%)")
    if not has_catalyst:
        out.append(_DAY_CHIP_MOMENTUM_ONLY)
    elif cc in ("macro", "analyst"):
        out.append(f"{_DAY_CHIP_TAPE_CATALYST} ({cc})")
    return out


def classify_mode_best_fit(
    *,
    gap_pct: float,
    volume_vs_avg: float,
    has_catalyst: bool,
    catalyst_category: str | None = None,
    catalyst_narrative_score: int | None = None,
) -> tuple[str, list[str]]:
    """Classify a gap's best-fit evaluation mode and return its reasoning chips.

    Returns a 2-tuple ``(mode_best_fit, reasons)`` where:

    * ``mode_best_fit`` is one of :data:`MODE_BEST_FIT_VALUES` (``"swing"`` /
      ``"day"`` / ``"either"``).
    * ``reasons`` is the short list of reasoning chips the UI shows below the
      tag so the classification is auditable. When the verdict is ``"swing"``
      or ``"day"``, only the chips that drove the winning side are returned;
      when the verdict is ``"either"``, the chips from both sides are
      concatenated so the user can see why the classifier could not pick.

    Decision rule: count swing-tilt and day-tilt signals (chips above). If one
    side wins by a margin of **at least 2**, that side is the verdict. Anything
    closer (0 / 0, 1 / 1, 2 / 2, 2 / 1, 1 / 2, 3 / 2, 2 / 3, …) is ``"either"``.
    A margin-2 threshold deliberately preserves ``"either"`` for cases where
    the gap legitimately straddles both engines — a 4% gap on bullish-earnings
    with heavy volume is plausibly tradable by both desks; the user gets to
    pick.
    """
    abs_gap = abs(float(gap_pct))
    vol_ratio = max(0.0, float(volume_vs_avg))

    swing = _swing_signals(
        abs_gap=abs_gap,
        has_catalyst=has_catalyst,
        catalyst_category=catalyst_category,
        catalyst_narrative_score=catalyst_narrative_score,
    )
    day = _day_signals(
        abs_gap=abs_gap,
        volume_vs_avg=vol_ratio,
        has_catalyst=has_catalyst,
        catalyst_category=catalyst_category,
    )

    swing_count = len(swing)
    day_count = len(day)

    if swing_count - day_count >= 2:
        return "swing", swing
    if day_count - swing_count >= 2:
        return "day", day
    return "either", swing + day


def _catalyst_lookback_hours_at(ny: datetime) -> int:
    """
    Regular session Mon–Fri 9:30–16:00 America/New_York → 24h news lookback; else 48h
    (evenings/weekends catch prior session catalyst headlines).
    """
    wd = ny.weekday()
    if wd >= 5:
        return 48
    mins = ny.hour * 60 + ny.minute
    open_mins = 9 * 60 + 30
    close_mins = 16 * 60
    if open_mins <= mins < close_mins:
        return 24
    return 48


def _get_catalyst_lookback_hours() -> int:
    ny = datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York"))
    return _catalyst_lookback_hours_at(ny)


_RTH_SESSION_MINUTES = 390  # 9:30–16:00 ET


def _is_outside_rth_ny(now_utc: datetime | None = None) -> bool:
    """True before 9:30 or after 16:00 ET Mon–Fri, or on weekends."""
    return _minutes_since_open_ny(now_utc) is None


def _minutes_since_open_ny(now_utc: datetime | None = None) -> int | None:
    """Minutes since 9:30 ET on a weekday session, or None outside RTH."""
    ny = (now_utc or datetime.now(timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    if ny.weekday() >= 5:
        return None
    mins = ny.hour * 60 + ny.minute
    open_mins = 9 * 60 + 30
    close_mins = 16 * 60
    if mins < open_mins or mins >= close_mins:
        return None
    return mins - open_mins


def _time_adjusted_volume_ratio(
    day_volume: float,
    prev_day_volume: float | None,
    *,
    now_utc: datetime | None = None,
) -> float:
    """Today's volume vs expected cumulative volume at this point in the session."""
    if prev_day_volume is None or prev_day_volume <= 0:
        return 1.0
    mins = _minutes_since_open_ny(now_utc)
    if mins is None:
        return 1.0
    frac = max(mins / _RTH_SESSION_MINUTES, 1.0 / _RTH_SESSION_MINUTES)
    expected = float(prev_day_volume) * frac
    if expected <= 0:
        return 0.0
    return float(day_volume) / expected


def _passes_volume_vs_adv_gate(
    day_volume: float,
    prev_day_volume: float | None,
    volume_vs_avg: float,
    *,
    now_utc: datetime | None = None,
) -> bool:
    """
    Session-aware relative volume gate.

    Pre-open: no gate. Early RTH: time-adjusted RVOL with loose thresholds; later
    sessions require stronger participation vs expected volume at this clock time.
    """
    if _is_outside_rth_ny(now_utc):
        return True
    mins = _minutes_since_open_ny(now_utc)
    if mins is None:
        return True
    tadj = _time_adjusted_volume_ratio(day_volume, prev_day_volume, now_utc=now_utc)
    if mins < 30:
        return tadj >= 0.3
    if mins < 60:
        return tadj >= 0.5
    return tadj >= 0.8


def _min_gap_quality_score(*, has_earnings_catalyst: bool, now_utc: datetime | None = None) -> int:
    if has_earnings_catalyst:
        return 20
    mins = _minutes_since_open_ny(now_utc)
    if mins is not None and mins < 30:
        return 25
    return 40


def _filter_articles_last_hours(articles: list[NewsArticle], *, hours: int) -> list[NewsArticle]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [a for a in articles if a.published_at >= cutoff]


@dataclass
class _GapWork:
    gap: PremarketGapCandidate
    snap: Snapshot | None
    company_name: str
    volume_vs_avg: float
    adv: float | None


def _first_ticker_position_in_title(title: str, symbol: str) -> int | None:
    sym = symbol.strip()
    if not sym:
        return None
    m = re.search(rf"\b{re.escape(sym)}\b", title, re.IGNORECASE)
    return m.start() if m else None


def _pick_primary_gap_index(items: list[dict[str, Any]], indices: list[int]) -> int:
    """Prefer ticker appearing earliest in the headline; tie-break on higher gap_quality_score."""
    cat0 = items[indices[0]].get("catalyst")
    headline = str(cat0.get("headline") or "") if isinstance(cat0, dict) else ""
    scored: list[tuple[int, int, int]] = []
    for i in indices:
        sym = str(items[i].get("symbol") or "").strip().upper()
        pos = _first_ticker_position_in_title(headline, sym)
        pos_key = pos if pos is not None else 9999
        gqs = int(items[i].get("gap_quality_score") or 0)
        scored.append((pos_key, -gqs, i))
    scored.sort()
    return scored[0][2]


def _dedupe_shared_catalyst_headlines(items: list[dict[str, Any]]) -> None:
    """Same article/headline on multiple gap cards: keep primary headline on one symbol only."""
    groups: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(items):
        cat = row.get("catalyst")
        if not isinstance(cat, dict):
            continue
        hid = str(cat.get("article_id") or "").strip()
        hl = str(cat.get("headline") or "").strip().lower()
        if not hl:
            continue
        key = hid if hid else f"headline:{hl}"
        groups[key].append(i)
    for idxs in groups.values():
        if len(idxs) < 2:
            continue
        primary_i = _pick_primary_gap_index(items, idxs)
        for i in idxs:
            if i == primary_i:
                continue
            cat = items[i].get("catalyst")
            if isinstance(cat, dict):
                cat["headline"] = SECONDARY_SHARED_CATALYST_HEADLINE


def _prepare_work_items(
    gaps: list[PremarketGapCandidate],
    snapshot_by_symbol: dict[str, Snapshot],
) -> list[_GapWork]:
    out: list[_GapWork] = []
    for g in gaps:
        snap = snapshot_by_symbol.get(g.symbol)
        company_name = (snap.company_name.strip() if snap and snap.company_name else "") or ""
        prev_v = float(snap.prev_day_volume) if snap and snap.prev_day_volume is not None else None
        vol_ratio = _volume_vs_adv(g.day_volume, prev_v)
        out.append(_GapWork(gap=g, snap=snap, company_name=company_name, volume_vs_avg=vol_ratio, adv=prev_v))
    return out


def build_gap_intelligence_items(
    gaps: list[PremarketGapCandidate],
    snapshot_by_symbol: dict[str, Snapshot],
    articles: list[NewsArticle],
    *,
    detector: NewsCatalystDetector | None = None,
    news_lookback_hours: int | None = None,
    earnings_events: list[EarningsEvent] | None = None,
    session_date: date | None = None,
) -> list[dict[str, Any]]:
    det = detector or NewsCatalystDetector(min_score=0.35)
    lookback_hours = news_lookback_hours if news_lookback_hours is not None else _get_catalyst_lookback_hours()
    arts = _filter_articles_last_hours(articles, hours=lookback_hours)
    work = _prepare_work_items(gaps, snapshot_by_symbol)
    earnings_index = index_earnings_by_symbol(earnings_events or [])
    sess_date = session_date or datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York")).date()
    items: list[dict[str, Any]] = []

    for w in work:
        g = w.gap
        price = float(g.premarket_price)
        day_vol = float(g.day_volume)
        prev_v = w.adv

        if price < 5.0 or day_vol < 500_000:
            continue
        if prev_v is not None and prev_v > 0 and not _passes_volume_vs_adv_gate(
            day_vol, prev_v, w.volume_vs_avg
        ):
            continue

        best: NewsCatalystCandidate | None = None
        best_article: NewsArticle | None = None
        company = (w.company_name or "").strip() or None
        for art in arts:
            c = det.candidate_for_symbol(art, g.symbol, company_name=company)
            if c is None:
                continue
            if best is None or c.catalyst_score > best.catalyst_score:
                best = c
                best_article = art

        earnings_payload, _earnings_ev = match_earnings_catalyst(
            g.symbol, earnings_index, session_date=sess_date
        )
        has_earnings_cat = earnings_payload is not None
        has_cat = best is not None or has_earnings_cat
        if not has_cat:
            mismatch = 0
            noise_c = 0
            for art in arts:
                if not NewsCatalystDetector.article_relevant_for_gap(art, g.symbol, company):
                    mismatch += 1
                    continue
                if NewsCatalystDetector._headline_is_noise(art.title):
                    noise_c += 1
            _LOG.debug(
                "No catalyst for %s: articles_checked=%s after_time_filter=%s lookback_hours=%s "
                "ticker_mismatch_or_no_company_hint=%s noise_filtered=%s",
                g.symbol,
                len(articles),
                len(arts),
                lookback_hours,
                mismatch,
                noise_c,
            )
        narrative = int(best.narrative_score) if best is not None else None
        cat_type = best.catalyst_type if best is not None else None
        cat_sent = best.sentiment_label if best is not None else None
        if earnings_payload is not None and best is None:
            narrative = int(earnings_payload.get("score") or 72)
            cat_type = str(earnings_payload.get("category") or "earnings")
            cat_sent = str(earnings_payload.get("sentiment") or "neutral")
        gqs = calculate_gap_quality_score(
            g.gap_percent,
            w.volume_vs_avg,
            has_cat,
            price,
            catalyst_narrative_score=narrative,
            catalyst_type=cat_type,
            catalyst_sentiment=cat_sent,
        )
        if gqs < _min_gap_quality_score(has_earnings_catalyst=has_earnings_cat):
            continue

        gap_dollars = round(price - float(g.prev_close), 4)
        catalyst_payload: dict[str, Any] | None = None
        if best is not None and best_article is not None:
            pub = best_article.published_at.isoformat() if best_article.published_at else ""
            catalyst_payload = {
                "article_id": best.article_id,
                "headline": best.title,
                "category": best.catalyst_type,
                "sentiment": best.sentiment_label,
                "score": best.narrative_score,
                "article_url": best_article.url,
                "article_description": (best_article.description or "").strip(),
                "published_at": pub,
                "source": (best_article.source or "").strip(),
            }
        elif best is not None:
            catalyst_payload = {
                "article_id": best.article_id,
                "headline": best.title,
                "category": best.catalyst_type,
                "sentiment": best.sentiment_label,
                "score": best.narrative_score,
            }
        elif earnings_payload is not None:
            catalyst_payload = dict(earnings_payload)

        mode_best_fit, mode_best_fit_reasons = classify_mode_best_fit(
            gap_pct=g.gap_percent,
            volume_vs_avg=w.volume_vs_avg,
            has_catalyst=has_cat,
            catalyst_category=cat_type,
            catalyst_narrative_score=narrative,
        )

        items.append(
            {
                "symbol": g.symbol,
                "company_name": w.company_name,
                "gap_pct": g.gap_percent,
                "gap_dollars": gap_dollars,
                "prev_close": g.prev_close,
                "current_price": price,
                "volume": int(day_vol),
                "volume_vs_avg": round(w.volume_vs_avg, 4),
                "gap_quality_score": gqs,
                "catalyst": catalyst_payload,
                "has_catalyst": has_cat,
                "no_catalyst_warning": None if has_cat else NO_CATALYST_WARNING,
                "mode_best_fit": mode_best_fit,
                "mode_best_fit_reasons": mode_best_fit_reasons,
            }
        )

    _dedupe_shared_catalyst_headlines(items)
    items.sort(key=lambda row: (row["has_catalyst"], row["gap_quality_score"]), reverse=True)
    return items[:10]


def enrich_gap_items_with_market_context(
    items: list[dict[str, Any]],
    *,
    references_by_symbol: dict[str, TickerReference | None] | None = None,
) -> list[dict[str, Any]]:
    """Attach IPO/index context and down-rank volume on unseasoned or inclusion-window names."""
    refs = references_by_symbol or {}
    kept: list[dict[str, Any]] = []
    for row in items:
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym:
            continue
        flags = resolve_market_context_flags(sym, reference=refs.get(sym))
        row["market_context_flags"] = flags
        warn = gap_item_market_context_warning(flags)
        if warn:
            row["market_context_warning"] = warn
        # Unseasoned listed issuers: exclude from ranked movers (composite blocks these).
        if flags.get("ipo_unseasoned") and flags.get("ecosystem_role") == "listed_issuer":
            continue
        if flags.get("ipo_unseasoned") or flags.get("index_inclusion_window"):
            cat = row.get("catalyst") if isinstance(row.get("catalyst"), dict) else None
            cat_type = str(cat.get("category") or "") if cat else None
            cat_sent = str(cat.get("sentiment") or "") if cat else None
            narrative = int(cat.get("score") or 0) if cat and cat.get("score") is not None else None
            row["gap_quality_score"] = calculate_gap_quality_score(
                float(row.get("gap_pct") or 0.0),
                float(row.get("volume_vs_avg") or 1.0),
                bool(row.get("has_catalyst")),
                float(row.get("current_price") or 0.0),
                catalyst_narrative_score=narrative,
                catalyst_type=cat_type or None,
                catalyst_sentiment=cat_sent or None,
                cap_volume_for_mechanical_flow=True,
            )
        kept.append(row)
    kept.sort(key=lambda row: (row.get("has_catalyst"), row.get("gap_quality_score")), reverse=True)
    return kept

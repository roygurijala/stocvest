"""B71 Phase C — offline news event-study analytics (read-only, no live wiring).

Joins B71 Phase B captured news events (``NewsSnapshot.top_events`` on each
:class:`~stocvest.data.models.SignalRecord`) to that signal's stored forward
returns to estimate, **per symbol**:

* ``sensitivity_ratio`` — mean ``|forward return|`` on news-bearing signals vs.
  on non-news signals (a coarse "news beta"). ``> 1`` ⇒ the stock tends to move
  more on news days than on quiet days.
* ``predictiveness`` — fraction of news-bearing signals where our captured
  sentiment **sign** matched the realized forward-return **sign** (directional
  skill of the polarity read).

This module is **exploratory / report-only**: it does not feed the composite
engine. The Phase C "learn → bounded up-weight" wiring is intentionally gated on
validating these numbers first (see ``docs/BACKLOG.md`` B71).

Method notes / caveats:

* The join is **signal-co-temporal**: forward returns are stored relative to
  ``generated_at``, not each headline's ``published_at``. A signal is treated as
  "news-bearing" when its snapshot carries captured events (or a non-zero
  weighted sentiment) at signal time. Event-timestamp-precise abnormal returns
  would require offline Polygon bars and are out of scope for this first pass.
* ``forward_return = (price_after - price_at_signal) / price_at_signal`` using
  the 1d horizon by default (falls back to 1h). Only resolved rows contribute.
* **No network / no writes** — uses only fields already stored on the record.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from statistics import fmean
from typing import Any, Iterable, Literal

from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import NewsSnapshot, TechnicalSnapshot
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

Horizon = Literal["1h", "1d"]

# Below this absolute magnitude a return or sentiment read is treated as "flat"
# (no directional information) and excluded from the predictiveness denominator.
_SIGN_EPS = 1e-6

# Default minimum resolved news-bearing samples before a symbol's stats are
# reported — small samples produce meaningless ratios.
DEFAULT_MIN_NEWS_SAMPLES = 8


def _sign(x: float) -> int:
    if x > _SIGN_EPS:
        return 1
    if x < -_SIGN_EPS:
        return -1
    return 0


@dataclass(frozen=True)
class EventStudyRow:
    """One signal flattened for the event study (signal-co-temporal join)."""

    symbol: str
    mode: str
    generated_at: datetime
    has_news: bool
    news_sentiment: float | None
    fwd_return: float | None
    atr_pct: float | None

    @property
    def abs_fwd_return(self) -> float | None:
        return abs(self.fwd_return) if self.fwd_return is not None else None


@dataclass(frozen=True)
class SymbolSensitivity:
    """Per-symbol aggregate of news sensitivity + sentiment predictiveness."""

    symbol: str
    n_total: int
    n_news_resolved: int
    n_baseline_resolved: int
    mean_abs_news: float | None
    mean_abs_baseline: float | None
    sensitivity_ratio: float | None
    predictiveness: float | None
    n_predictive: int
    mean_atr_pct: float | None


def _news_signal_info(rec: SignalRecord) -> tuple[bool, float | None]:
    """Return ``(has_news, signed_sentiment)`` parsed from ``news_snapshot_json``.

    ``has_news`` is True when the snapshot carries captured events or a non-zero
    article count. ``signed_sentiment`` prefers ``weighted_sentiment``, then the
    aggregate ``sentiment_score``, then the mean of per-event scores.
    """
    raw = rec.news_snapshot_json
    if not raw:
        return False, None
    try:
        snap = NewsSnapshot.model_validate_json(raw)
    except Exception:  # noqa: BLE001 — malformed snapshot is just "no news signal"
        return False, None

    has_news = bool(snap.top_events) or snap.article_count > 0
    sentiment = snap.weighted_sentiment
    if sentiment is None:
        sentiment = snap.sentiment_score
    if sentiment is None and snap.top_events:
        scores = [e.sentiment_score for e in snap.top_events if e.sentiment_score is not None]
        if scores:
            sentiment = fmean(scores)
    return has_news, sentiment


def _forward_return(rec: SignalRecord, horizon: Horizon) -> float | None:
    """Stored forward return for the horizon, or ``None`` if unresolved/unusable."""
    base = rec.price_at_signal
    if not base or base <= 0:
        return None
    if horizon == "1h":
        resolved, after = rec.resolved_1h, rec.price_1h_after
    else:
        resolved, after = rec.resolved_1d, rec.price_1d_after
    if not resolved or after is None:
        return None
    return (after - base) / base


def _atr_pct(rec: SignalRecord) -> float | None:
    """ATR as a fraction of entry price, parsed from ``technical_snapshot_json`` (day path)."""
    raw = rec.technical_snapshot_json
    base = rec.price_at_signal
    if not raw or not base or base <= 0:
        return None
    try:
        tech = TechnicalSnapshot.model_validate_json(raw)
    except Exception:  # noqa: BLE001
        return None
    if tech.atr is None or tech.atr <= 0:
        return None
    return tech.atr / base


def build_event_study_rows(
    records: Iterable[SignalRecord],
    *,
    horizon: Horizon = "1d",
) -> list[EventStudyRow]:
    """Flatten signal records into event-study rows (one per record). Pure / read-only."""
    rows: list[EventStudyRow] = []
    for rec in records:
        has_news, sentiment = _news_signal_info(rec)
        rows.append(
            EventStudyRow(
                symbol=rec.symbol.strip().upper(),
                mode=rec.mode,
                generated_at=rec.generated_at,
                has_news=has_news,
                news_sentiment=sentiment,
                fwd_return=_forward_return(rec, horizon),
                atr_pct=_atr_pct(rec),
            )
        )
    return rows


def aggregate_symbol_sensitivity(
    rows: Iterable[EventStudyRow],
    *,
    min_news_samples: int = DEFAULT_MIN_NEWS_SAMPLES,
) -> dict[str, SymbolSensitivity]:
    """Aggregate event-study rows into per-symbol sensitivity + predictiveness.

    Only symbols with at least ``min_news_samples`` *resolved* news-bearing rows
    are returned (smaller samples are statistically meaningless).
    """
    by_symbol: dict[str, list[EventStudyRow]] = defaultdict(list)
    for r in rows:
        by_symbol[r.symbol].append(r)

    out: dict[str, SymbolSensitivity] = {}
    for symbol, srows in by_symbol.items():
        news_abs = [r.abs_fwd_return for r in srows if r.has_news and r.abs_fwd_return is not None]
        base_abs = [r.abs_fwd_return for r in srows if not r.has_news and r.abs_fwd_return is not None]
        if len(news_abs) < min_news_samples:
            continue

        mean_news = fmean(news_abs) if news_abs else None
        mean_base = fmean(base_abs) if base_abs else None
        ratio = (mean_news / mean_base) if (mean_news is not None and mean_base) else None

        # Predictiveness: among resolved news rows with a directional sentiment AND
        # a directional move, how often do the signs agree?
        agree = 0
        considered = 0
        for r in srows:
            if not r.has_news or r.fwd_return is None or r.news_sentiment is None:
                continue
            s_sent = _sign(r.news_sentiment)
            s_ret = _sign(r.fwd_return)
            if s_sent == 0 or s_ret == 0:
                continue
            considered += 1
            if s_sent == s_ret:
                agree += 1
        predictiveness = (agree / considered) if considered else None

        atr_vals = [r.atr_pct for r in srows if r.atr_pct is not None]
        out[symbol] = SymbolSensitivity(
            symbol=symbol,
            n_total=len(srows),
            n_news_resolved=len(news_abs),
            n_baseline_resolved=len(base_abs),
            mean_abs_news=mean_news,
            mean_abs_baseline=mean_base,
            sensitivity_ratio=ratio,
            predictiveness=predictiveness,
            n_predictive=considered,
            mean_atr_pct=(fmean(atr_vals) if atr_vals else None),
        )
    return out


def build_sensitivity_report(
    records: Iterable[SignalRecord],
    *,
    horizon: Horizon = "1d",
    min_news_samples: int = DEFAULT_MIN_NEWS_SAMPLES,
) -> dict[str, Any]:
    """Build a JSON-serializable per-symbol sensitivity report (pure / read-only).

    Shared by the CLI and the scheduled Lambda so both produce identical output.
    """
    rows = build_event_study_rows(records, horizon=horizon)
    sensitivities = aggregate_symbol_sensitivity(rows, min_news_samples=min_news_samples)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "horizon": horizon,
        "min_news_samples": min_news_samples,
        "record_count": len(rows),
        "symbol_count": len(sensitivities),
        "symbols": {sym: asdict(s) for sym, s in sensitivities.items()},
    }

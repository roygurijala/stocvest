"""ADR-004 POS-AI-9 — offline tuner for the Position news recency-decay curve.

Read-only analytics. Joins each captured Position ledger signal's **freshest**
news-article age (from ``NewsSnapshot.top_events[].published_at``) to that
signal's realized directional outcome, then derives a data-driven recency-decay
curve to *compare against* the live hand-set curve in
:func:`stocvest.signals.news_sentiment.position_recency_weight`.

**This module never mutates the live decay.** It only reports what the ledger
implies, gated on sufficient sample size — during the VAL-POS soak there is
little/no data, so :func:`derive_recommended_decay` returns ``None``
(``insufficient_data``) by design. That is the whole point of POS-AI-9: replace
the interim hand-set curve only once the ledger can justify each bucket weight.

Method + caveats (this is a coarse, signal-co-temporal join, matching the
precedent in ``news_event_study.py``):

* Representative age per signal = the **freshest** captured qualifying article's
  age vs ``generated_at``. Signals whose freshest news is already weeks old are
  exactly the ones that test whether stale-only news is still informative.
* Outcome label = directional ``outcome_1d`` (``correct`` / ``incorrect``);
  ``neutral`` / unresolved rows are excluded.
* Recommended weight per bucket = empirical hit-rate **relative to the freshest
  (0-7d) bucket**, clamped to ``[FLOOR, 1.0]`` and forced monotonically
  non-increasing with age. The freshest bucket anchors at ``1.0``. Buckets with
  no data fall back to the current live weight (we cannot recommend blind).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import NewsSnapshot
from stocvest.signals.news_sentiment import position_recency_weight
from stocvest.signals.product_kpi import wilson_score_interval

# Age-bucket boundaries (days) — MUST mirror ``position_recency_weight`` steps.
AGE_BUCKET_BOUNDS_DAYS: tuple[float, ...] = (7.0, 14.0, 21.0, 30.0)
AGE_BUCKET_LABELS: tuple[str, ...] = ("0-7", "8-14", "15-21", "22-30", "31+")

# A representative age inside each bucket, used to snapshot the live curve so a
# unit test can assert this table never drifts from ``position_recency_weight``.
_BUCKET_PROBE_AGE_DAYS: dict[str, float] = {
    "0-7": 3.0,
    "8-14": 10.0,
    "15-21": 18.0,
    "22-30": 26.0,
    "31+": 45.0,
}


def _live_curve() -> dict[str, float]:
    """The live decay weights, read straight from ``position_recency_weight``."""
    ref = datetime(2026, 1, 31, tzinfo=timezone.utc)
    out: dict[str, float] = {}
    for label, age in _BUCKET_PROBE_AGE_DAYS.items():
        published = ref - timedelta(days=age)
        out[label] = round(position_recency_weight(published, ref), 4)
    return out


LIVE_DECAY_BY_BUCKET: dict[str, float] = _live_curve()

# Minimum resolved signals *per populated bucket* before a full recommendation is
# emitted. Below this the deriver refuses (insufficient_data). Deliberately
# conservative — POS-AI-9 forbids tuning off thin samples.
DEFAULT_MIN_SAMPLES_PER_BUCKET = 30

# Never recommend a bucket weight below this floor off noisy data (a bucket that
# looks worthless on 30 samples may not be).
RECOMMEND_FLOOR = 0.10


def bucket_for_age_days(age_days: float) -> str:
    """Map an article age (days) to its decay bucket label."""
    a = float(age_days)
    for bound, label in zip(AGE_BUCKET_BOUNDS_DAYS, AGE_BUCKET_LABELS):
        if a <= bound:
            return label
    return AGE_BUCKET_LABELS[-1]


def _parse_dt(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def freshest_news_age_days(rec: SignalRecord) -> float | None:
    """Age (days) of the freshest dated article in the signal's news snapshot."""
    raw = rec.news_snapshot_json
    gen = rec.generated_at
    if not raw or gen is None:
        return None
    try:
        snap = NewsSnapshot.model_validate_json(raw)
    except Exception:  # noqa: BLE001 — malformed snapshot ⇒ no usable news age
        return None
    gen_utc = gen if gen.tzinfo else gen.replace(tzinfo=timezone.utc)
    ages: list[float] = []
    for ev in snap.top_events:
        pub = _parse_dt(ev.published_at)
        if pub is None:
            continue
        age = (gen_utc - pub).total_seconds() / 86_400.0
        if age >= 0:
            ages.append(age)
    return min(ages) if ages else None


def _outcome_correct(rec: SignalRecord) -> bool | None:
    """``True`` for a correct directional 1d outcome, ``False`` incorrect, else ``None``."""
    oc = str(rec.outcome_1d or "").strip().lower()
    if oc == "correct":
        return True
    if oc == "incorrect":
        return False
    return None


@dataclass(frozen=True)
class DecaySample:
    """One resolved Position signal reduced to (freshest news age, correctness)."""

    age_days: float
    correct: bool


def build_decay_samples(records: Iterable[SignalRecord]) -> list[DecaySample]:
    """Flatten resolved Position ledger rows into decay samples. Pure / read-only."""
    samples: list[DecaySample] = []
    for rec in records:
        if str(getattr(rec, "mode", "")).strip().lower() != "position":
            continue
        correct = _outcome_correct(rec)
        if correct is None:
            continue
        age = freshest_news_age_days(rec)
        if age is None:
            continue
        samples.append(DecaySample(age_days=age, correct=correct))
    return samples


@dataclass
class BucketStat:
    label: str
    n_correct: int = 0
    n_incorrect: int = 0

    @property
    def n(self) -> int:
        return self.n_correct + self.n_incorrect

    @property
    def hit_rate(self) -> float | None:
        return (self.n_correct / self.n) if self.n > 0 else None

    @property
    def wilson_ci(self) -> tuple[float, float] | None:
        return wilson_score_interval(self.n_correct, self.n_incorrect)

    def to_dict(self) -> dict[str, Any]:
        return {
            "bucket": self.label,
            "n": self.n,
            "correct": self.n_correct,
            "incorrect": self.n_incorrect,
            "hit_rate": (round(self.hit_rate, 4) if self.hit_rate is not None else None),
            "wilson_ci": (
                [round(self.wilson_ci[0], 4), round(self.wilson_ci[1], 4)]
                if self.wilson_ci is not None
                else None
            ),
            "live_weight": LIVE_DECAY_BY_BUCKET[self.label],
        }


def aggregate_buckets(samples: Iterable[DecaySample]) -> dict[str, BucketStat]:
    """Aggregate samples into a stat per bucket (all labels present, zero-filled)."""
    stats: dict[str, BucketStat] = {label: BucketStat(label) for label in AGE_BUCKET_LABELS}
    for s in samples:
        st = stats[bucket_for_age_days(s.age_days)]
        if s.correct:
            st.n_correct += 1
        else:
            st.n_incorrect += 1
    return stats


@dataclass
class DecayTuningResult:
    status: str  # "recommended" | "insufficient_data"
    reason: str
    buckets: list[dict[str, Any]]
    live_curve: dict[str, float]
    recommended_curve: dict[str, float] | None
    n_samples: int
    min_samples: int = field(default=DEFAULT_MIN_SAMPLES_PER_BUCKET)

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": self.status,
            "reason": self.reason,
            "n_samples": self.n_samples,
            "min_samples_per_bucket": self.min_samples,
            "live_curve": self.live_curve,
            "recommended_curve": self.recommended_curve,
            "buckets": self.buckets,
        }


def derive_recommended_decay(
    bucket_stats: dict[str, BucketStat],
    *,
    min_samples: int = DEFAULT_MIN_SAMPLES_PER_BUCKET,
    floor: float = RECOMMEND_FLOOR,
) -> DecayTuningResult:
    """Derive a data-driven decay curve from per-bucket hit-rates.

    Refuses (``insufficient_data``) unless the freshest (0-7d) reference bucket has
    ``>= min_samples`` resolved signals with a positive hit-rate AND no *populated*
    bucket is below ``min_samples``. Otherwise anchors the freshest bucket at 1.0,
    scales each other bucket by its hit-rate relative to the reference, clamps to
    ``[floor, 1.0]``, fills empty buckets from the live curve, and enforces a
    monotonically non-increasing curve with age. Live constants are never touched.
    """
    buckets = [bucket_stats[label].to_dict() for label in AGE_BUCKET_LABELS]
    n_total = sum(bucket_stats[label].n for label in AGE_BUCKET_LABELS)

    ref = bucket_stats[AGE_BUCKET_LABELS[0]]
    if ref.n < min_samples or not ref.hit_rate:
        return DecayTuningResult(
            status="insufficient_data",
            reason=(
                f"reference bucket {AGE_BUCKET_LABELS[0]} has n={ref.n} "
                f"(need >= {min_samples}) with a positive hit-rate"
            ),
            buckets=buckets,
            live_curve=dict(LIVE_DECAY_BY_BUCKET),
            recommended_curve=None,
            n_samples=n_total,
            min_samples=min_samples,
        )
    thin = [label for label in AGE_BUCKET_LABELS if 0 < bucket_stats[label].n < min_samples]
    if thin:
        return DecayTuningResult(
            status="insufficient_data",
            reason=f"populated bucket(s) below min_samples: {', '.join(thin)}",
            buckets=buckets,
            live_curve=dict(LIVE_DECAY_BY_BUCKET),
            recommended_curve=None,
            n_samples=n_total,
            min_samples=min_samples,
        )

    ref_rate = ref.hit_rate
    recommended: dict[str, float] = {}
    prev = 1.0
    for label in AGE_BUCKET_LABELS:
        st = bucket_stats[label]
        if st.n == 0 or st.hit_rate is None:
            raw = LIVE_DECAY_BY_BUCKET[label]  # no data ⇒ keep the live weight
        else:
            raw = max(floor, min(1.0, st.hit_rate / ref_rate))
        raw = min(raw, prev)  # decay must be non-increasing with age
        recommended[label] = round(raw, 3)
        prev = raw

    return DecayTuningResult(
        status="recommended",
        reason="derived from ledger hit-rate relative to the freshest bucket",
        buckets=buckets,
        live_curve=dict(LIVE_DECAY_BY_BUCKET),
        recommended_curve=recommended,
        n_samples=n_total,
        min_samples=min_samples,
    )


def build_decay_tuning_report(
    records: Iterable[SignalRecord],
    *,
    min_samples: int = DEFAULT_MIN_SAMPLES_PER_BUCKET,
) -> dict[str, Any]:
    """End-to-end (records → report dict). Pure / read-only; shared by CLI + tests."""
    samples = build_decay_samples(records)
    stats = aggregate_buckets(samples)
    result = derive_recommended_decay(stats, min_samples=min_samples)
    return result.to_dict()

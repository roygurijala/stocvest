"""Aggregate signal history for monthly tuning (read-only analytics over stored snapshots)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import LayerScoresSnapshot, TechnicalSnapshot

_EPS = 0.0001


def _parse_period(period: str) -> timedelta:
    p = (period or "30d").strip().lower()
    if p.endswith("d"):
        try:
            days = int(p[:-1] or "30")
        except ValueError:
            days = 30
        return timedelta(days=max(1, min(days, 366)))
    if p.endswith("h"):
        try:
            hours = int(p[:-1] or "24")
        except ValueError:
            hours = 24
        return timedelta(hours=max(1, min(hours, 8760)))
    return timedelta(days=30)


def _in_window(rec: SignalRecord, cutoff: datetime) -> bool:
    ga = rec.generated_at
    if ga.tzinfo is None:
        ga = ga.replace(tzinfo=timezone.utc)
    return ga >= cutoff


def _parse_technical_json(raw: str | None) -> TechnicalSnapshot | None:
    if not raw or not str(raw).strip():
        return None
    try:
        return TechnicalSnapshot.model_validate_json(raw)
    except Exception:
        return None


def _parse_layer_scores_json(raw: str | None) -> LayerScoresSnapshot | None:
    if not raw or not str(raw).strip():
        return None
    try:
        return LayerScoresSnapshot.model_validate_json(raw)
    except Exception:
        return None


def _rsi_bucket(tech: TechnicalSnapshot | None) -> str:
    if tech is None or tech.rsi is None:
        return "unknown"
    r = float(tech.rsi)
    lo = int(max(0, (r // 10) * 10))
    hi = lo + 10
    return f"{lo}-{hi}"


def _volume_bucket(tech: TechnicalSnapshot | None) -> str:
    if tech is None or tech.volume_ratio is None:
        return "unknown"
    v = float(tech.volume_ratio)
    if v < 0.8:
        return "lt_0.8"
    if v < 1.2:
        return "0.8_1.2"
    if v < 1.5:
        return "1.2_1.5"
    return "ge_1.5"


def _price_move_up(rec: SignalRecord) -> bool | None:
    if rec.price_1h_after is None:
        return None
    if rec.price_at_signal <= 0:
        return None
    return rec.price_1h_after > rec.price_at_signal * (1.0 + _EPS)


def _layer_predicted_up(layer_key: str, rec: SignalRecord) -> bool | None:
    raw = rec.layer_scores.get(layer_key)
    if raw is None and layer_key == "geopolitical":
        raw = rec.layer_scores.get("geo")
    if raw is None:
        return None
    if abs(float(raw)) < 1e-9:
        return None
    return float(raw) > 0


def _layer_accuracy_for_key(records: list[SignalRecord], layer_key: str) -> float | None:
    usable = 0
    good = 0
    for rec in records:
        if rec.outcome_1h not in ("correct", "incorrect"):
            continue
        move = _price_move_up(rec)
        pred = _layer_predicted_up(layer_key, rec)
        if move is None or pred is None:
            continue
        usable += 1
        if (move and pred) or ((not move) and (not pred)):
            good += 1
    if usable == 0:
        return None
    return round(good / usable, 4)


def _accuracy_1h(records: list[SignalRecord]) -> float | None:
    ev = [r for r in records if r.outcome_1h in ("correct", "incorrect")]
    if not ev:
        return None
    return round(sum(1 for r in ev if r.outcome_1h == "correct") / len(ev), 4)


def _accuracy_1d(records: list[SignalRecord]) -> float | None:
    ev = [r for r in records if r.outcome_1d in ("correct", "incorrect")]
    if not ev:
        return None
    return round(sum(1 for r in ev if r.outcome_1d == "correct") / len(ev), 4)


def _aggregate(
    scoped: list[SignalRecord],
    key_fn: Callable[[SignalRecord], str],
    label_key: str,
) -> list[dict[str, Any]]:
    groups: dict[str, list[SignalRecord]] = defaultdict(list)
    for rec in scoped:
        groups[str(key_fn(rec))].append(rec)
    out: list[dict[str, Any]] = []
    for key in sorted(groups.keys()):
        rs = groups[key]
        strengths = [r.signal_strength for r in rs]
        avg_strength = round(sum(strengths) / len(strengths), 1) if strengths else None
        row: dict[str, Any] = {
            label_key: key,
            "count": len(rs),
            "accuracy_1h": _accuracy_1h(rs),
            "accuracy_1d": _accuracy_1d(rs),
        }
        if label_key == "bucket":
            row["avg_strength"] = avg_strength
        out.append(row)
    return out


def build_signal_analysis_payload(*, records: list[SignalRecord], period: str) -> dict[str, Any]:
    window = _parse_period(period)
    cutoff = datetime.now(timezone.utc) - window
    scoped = [r for r in records if _in_window(r, cutoff)]
    with_outcomes = [r for r in scoped if r.outcome_1h is not None or r.outcome_1d is not None]

    by_rsi = _aggregate(scoped, lambda r: _rsi_bucket(_parse_technical_json(r.technical_snapshot_json)), "bucket")

    def _vwap(r: SignalRecord) -> str:
        t = _parse_technical_json(r.technical_snapshot_json)
        return t.price_vs_vwap if t and t.price_vs_vwap else "unknown"

    def _orb(r: SignalRecord) -> str:
        t = _parse_technical_json(r.technical_snapshot_json)
        return str(t.orb_signal) if t and t.orb_signal else "none"

    by_vwap = _aggregate(scoped, _vwap, "position")
    by_orb = _aggregate(scoped, _orb, "orb_signal")
    by_volume = _aggregate(scoped, lambda r: _volume_bucket(_parse_technical_json(r.technical_snapshot_json)), "bucket")

    def _pver(r: SignalRecord) -> str:
        v = (r.parameter_version or "").strip()
        return v if v else "unset"

    by_param = _aggregate(scoped, _pver, "parameter_version")

    def _conf(r: SignalRecord) -> str:
        ls = _parse_layer_scores_json(r.layer_scores_json)
        if ls is None:
            return "unknown"
        n = len(ls.confluence_confirming)
        if n >= 4:
            return "4_plus_confirming"
        return f"{n}_confirming"

    confluence_rows = _aggregate(scoped, _conf, "bucket")
    confluence_accuracy: dict[str, float | None] = {
        str(row["bucket"]): row.get("accuracy_1h") for row in confluence_rows if "bucket" in row
    }

    layer_keys = ("technical", "news", "macro", "sector", "geopolitical", "internals")
    layer_accuracy: dict[str, float | None] = {
        f"{k}_predicts_outcome": _layer_accuracy_for_key(with_outcomes, k) for k in layer_keys
    }

    return {
        "period": period,
        "total_signals": len(scoped),
        "signals_with_outcomes": len(with_outcomes),
        "by_rsi_bucket": by_rsi,
        "by_vwap_position": by_vwap,
        "by_orb_signal": by_orb,
        "by_volume_bucket": by_volume,
        "by_layers_aligned": [],
        "by_parameter_version": by_param,
        "layer_accuracy": layer_accuracy,
        "confluence_accuracy": confluence_accuracy,
    }


def analysis_authorized(*, user_id: str | None, claims: dict[str, Any], headers: dict[str, Any]) -> bool:
    from stocvest.utils.config import get_settings

    settings = get_settings()
    hdr = {str(k).lower(): str(v) for k, v in (headers or {}).items() if isinstance(k, str)}
    internal = (settings.stocvest_internal_analysis_key or "").strip()
    if internal and hdr.get("x-stocvest-internal-analysis") == internal:
        return True
    subs_raw = (settings.stocvest_analysis_admin_subs or "").strip()
    if user_id and subs_raw:
        allowed = {s.strip() for s in subs_raw.split(",") if s.strip()}
        if user_id in allowed:
            return True
    groups = claims.get("cognito:groups")
    if isinstance(groups, str) and "signal-analytics-admin" in groups:
        return True
    if isinstance(groups, list) and "signal-analytics-admin" in groups:
        return True
    return False

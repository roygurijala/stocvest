"""
Offline replay of VIX environment enter bands against stored ledger rows.

This is **not** a synthetic backtest (no bar replay, no regenerated signals). Each row is a
real ``SignalHistory`` capture with ``gate_status_json`` / ``market_environment_audit``.
We re-classify the stored ``vix_level`` under candidate enter thresholds and measure:

- how often swing/day ledger environment gates would block new entries
- directional accuracy (1h / 1d) on allowed vs blocked subsets

Hysteresis is **not** replayed (would require full tier state series). Use this tool to
tune enter bands and spike overlays; keep exit bands fixed in production until a follow-up.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from stocvest.api.services.market_environment import (
    TIER_CRISIS_ENTER,
    TIER_ELEVATED_ENTER,
    TIER_NORMAL_ENTER,
    EnvironmentTier,
)
from stocvest.data.models import SignalRecord

Horizon = Literal["1h", "1d"]
Mode = Literal["day", "swing"]


@dataclass(frozen=True)
class EnvironmentBandConfig:
    """Enter-band candidate (matches ``market_environment`` spike constants by default)."""

    normal_enter: float = TIER_NORMAL_ENTER
    elevated_enter: float = TIER_ELEVATED_ENTER
    crisis_enter: float = TIER_CRISIS_ENTER
    spike_min_vix: float = 22.0
    spike_change_pct: float = 10.0
    spike_5d_min_vix: float = 20.0
    spike_5d_change_pct: float = 12.0

    def key(self) -> str:
        return (
            f"n{self.normal_enter:g}_e{self.elevated_enter:g}_c{self.crisis_enter:g}"
            f"_sp{self.spike_change_pct:g}"
        )


PRODUCTION_BANDS = EnvironmentBandConfig()


@dataclass
class BacktestRow:
    signal_id: str
    mode: Mode
    vix_level: float | None
    vix_change_pct: float | None
    vix_change_5d_pct: float | None
    captured_tier: str | None
    ledger_qualified: bool
    outcome_1h: str | None
    outcome_1d: str | None


@dataclass
class AccuracySlice:
    correct: int = 0
    incorrect: int = 0
    neutral: int = 0

    @property
    def resolved_directional(self) -> int:
        return self.correct + self.incorrect

    @property
    def accuracy(self) -> float:
        d = self.resolved_directional
        return math.nan if d == 0 else self.correct / d


@dataclass
class CandidateMetrics:
    config: EnvironmentBandConfig
    rows_total: int = 0
    rows_with_vix: int = 0
    tier_counts: dict[str, int] = field(default_factory=dict)
    tier_match_captured: int = 0
    swing_allowed: AccuracySlice = field(default_factory=AccuracySlice)
    swing_blocked: AccuracySlice = field(default_factory=AccuracySlice)
    day_allowed: AccuracySlice = field(default_factory=AccuracySlice)
    day_blocked: AccuracySlice = field(default_factory=AccuracySlice)

    @property
    def tier_agreement_pct(self) -> float:
        if self.rows_with_vix <= 0:
            return math.nan
        return self.tier_match_captured / self.rows_with_vix

    def swing_block_rate(self) -> float:
        swing_n = self.swing_allowed.resolved_directional + self.swing_blocked.resolved_directional
        if swing_n == 0:
            return math.nan
        return self.swing_blocked.resolved_directional / swing_n

    def day_block_rate(self) -> float:
        day_n = self.day_allowed.resolved_directional + self.day_blocked.resolved_directional
        if day_n == 0:
            return math.nan
        return self.day_blocked.resolved_directional / day_n


def _float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _outcome_for_horizon(row: BacktestRow, horizon: Horizon) -> str | None:
    if horizon == "1h":
        return row.outcome_1h
    return row.outcome_1d


def _tally(slice_: AccuracySlice, outcome: str | None) -> None:
    if outcome == "correct":
        slice_.correct += 1
    elif outcome == "incorrect":
        slice_.incorrect += 1
    elif outcome == "neutral":
        slice_.neutral += 1


def resolve_tier_raw_for_config(
    *,
    vix_level: float | None,
    vix_change_pct: float | None = None,
    vix_change_5d_pct: float | None = None,
    config: EnvironmentBandConfig,
) -> EnvironmentTier:
    v = _float_or_none(vix_level)
    if v is None:
        return "normal"
    chg = _float_or_none(vix_change_pct)
    chg5 = _float_or_none(vix_change_5d_pct)
    spike_session = (
        chg is not None and chg >= config.spike_change_pct and v >= config.spike_min_vix
    )
    spike_5d = (
        chg5 is not None and chg5 >= config.spike_5d_change_pct and v >= config.spike_5d_min_vix
    )
    if v >= config.crisis_enter:
        return "crisis"
    if v >= config.elevated_enter or spike_session or spike_5d:
        return "stressed"
    if v >= config.normal_enter:
        return "elevated"
    return "normal"


def new_entries_allowed(tier: EnvironmentTier, mode: Mode) -> bool:
    """Mirror production ``build_market_environment_policy`` ledger flags."""
    if tier == "crisis":
        return False
    if tier == "stressed":
        return mode == "day"
    return True


def extract_backtest_row(record: SignalRecord) -> BacktestRow | None:
    """Pull replay fields from a ledger row; returns None without gate JSON."""
    raw = record.gate_status_json
    if not raw or not str(raw).strip():
        return None
    try:
        blob: Any = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(blob, dict):
        return None

    audit = blob.get("market_environment_audit")
    vix = None
    vix_chg = None
    vix_chg5 = None
    captured: str | None = None
    if isinstance(audit, dict):
        vix = _float_or_none(audit.get("vix_level"))
        vix_chg = _float_or_none(audit.get("vix_change_pct"))
        vix_chg5 = _float_or_none(audit.get("vix_change_5d_pct"))
        t = str(audit.get("environment_tier") or "").strip().lower()
        if t in ("normal", "elevated", "stressed", "crisis"):
            captured = t

    mode_raw = str(record.mode or "swing").strip().lower()
    mode: Mode = "day" if mode_raw == "day" else "swing"

    return BacktestRow(
        signal_id=str(record.signal_id or ""),
        mode=mode,
        vix_level=vix,
        vix_change_pct=vix_chg,
        vix_change_5d_pct=vix_chg5,
        captured_tier=captured,
        ledger_qualified=bool(record.ledger_qualified),
        outcome_1h=record.outcome_1h,
        outcome_1d=record.outcome_1d,
    )


def extract_backtest_rows(records: Iterable[SignalRecord]) -> list[BacktestRow]:
    out: list[BacktestRow] = []
    for rec in records:
        row = extract_backtest_row(rec)
        if row is not None:
            out.append(row)
    return out


def evaluate_candidate(
    rows: Iterable[BacktestRow],
    *,
    config: EnvironmentBandConfig,
    horizon: Horizon = "1d",
) -> CandidateMetrics:
    metrics = CandidateMetrics(config=config)
    for row in rows:
        metrics.rows_total += 1
        if row.vix_level is None:
            continue
        metrics.rows_with_vix += 1
        tier = resolve_tier_raw_for_config(
            vix_level=row.vix_level,
            vix_change_pct=row.vix_change_pct,
            vix_change_5d_pct=row.vix_change_5d_pct,
            config=config,
        )
        metrics.tier_counts[tier] = metrics.tier_counts.get(tier, 0) + 1
        if row.captured_tier and row.captured_tier == tier:
            metrics.tier_match_captured += 1

        allowed = new_entries_allowed(tier, row.mode)
        outcome = _outcome_for_horizon(row, horizon)
        if row.mode == "swing":
            _tally(metrics.swing_allowed if allowed else metrics.swing_blocked, outcome)
        else:
            _tally(metrics.day_allowed if allowed else metrics.day_blocked, outcome)
    return metrics


def default_grid() -> list[EnvironmentBandConfig]:
    """Coarse grid around production enter bands (3×3×2 = 54 candidates)."""
    normals = [18.0, 19.0, 20.0, 21.0]
    elevateds = [26.0, 27.0, 28.0, 29.0]
    crises = [31.0, 32.0, 33.0]
    configs: list[EnvironmentBandConfig] = []
    for n in normals:
        for e in elevateds:
            for c in crises:
                if n < e < c:
                    configs.append(
                        EnvironmentBandConfig(normal_enter=n, elevated_enter=e, crisis_enter=c)
                    )
    return configs


def rank_candidates(
    metrics_list: list[CandidateMetrics],
    *,
    mode: Mode = "swing",
) -> list[CandidateMetrics]:
    """Higher allowed-subset accuracy first; fewer blocks as tie-break."""

    def sort_key(m: CandidateMetrics) -> tuple[float, float, float]:
        allowed = m.swing_allowed if mode == "swing" else m.day_allowed
        acc = allowed.accuracy
        acc_key = acc if acc == acc else -1.0
        block = m.swing_block_rate() if mode == "swing" else m.day_block_rate()
        block_key = block if block == block else 2.0
        return (acc_key, -block_key, m.rows_with_vix)

    return sorted(metrics_list, key=sort_key, reverse=True)


def run_grid_search(
    rows: list[BacktestRow],
    *,
    horizon: Horizon = "1d",
    configs: list[EnvironmentBandConfig] | None = None,
) -> list[CandidateMetrics]:
    configs = configs or default_grid()
    baseline = evaluate_candidate(rows, config=PRODUCTION_BANDS, horizon=horizon)
    results = [baseline]
    for cfg in configs:
        if cfg.key() == PRODUCTION_BANDS.key():
            continue
        results.append(evaluate_candidate(rows, config=cfg, horizon=horizon))
    return results


def _pct_or_none(v: float) -> float | None:
    if v != v:
        return None
    return round(v * 100, 1)


def candidate_metrics_to_dict(m: CandidateMetrics) -> dict[str, Any]:
    """JSON-safe metrics for admin API and CLI export."""
    cfg = m.config
    return {
        "config_key": cfg.key(),
        "bands": {
            "normal_enter": cfg.normal_enter,
            "elevated_enter": cfg.elevated_enter,
            "crisis_enter": cfg.crisis_enter,
        },
        "rows_with_vix": m.rows_with_vix,
        "tier_counts": m.tier_counts,
        "tier_agreement_pct": _pct_or_none(m.tier_agreement_pct),
        "swing": {
            "allowed_accuracy_pct": _pct_or_none(m.swing_allowed.accuracy),
            "allowed_correct": m.swing_allowed.correct,
            "allowed_resolved": m.swing_allowed.resolved_directional,
            "blocked_accuracy_pct": _pct_or_none(m.swing_blocked.accuracy),
            "blocked_correct": m.swing_blocked.correct,
            "blocked_resolved": m.swing_blocked.resolved_directional,
            "block_rate_pct": _pct_or_none(m.swing_block_rate()),
        },
        "day": {
            "allowed_accuracy_pct": _pct_or_none(m.day_allowed.accuracy),
            "allowed_correct": m.day_allowed.correct,
            "allowed_resolved": m.day_allowed.resolved_directional,
            "blocked_accuracy_pct": _pct_or_none(m.day_blocked.accuracy),
            "blocked_correct": m.day_blocked.correct,
            "blocked_resolved": m.day_blocked.resolved_directional,
            "block_rate_pct": _pct_or_none(m.day_block_rate()),
        },
        "is_production": cfg.key() == PRODUCTION_BANDS.key(),
    }


def format_accuracy(acc: float) -> str:
    if acc != acc:
        return "—"
    return f"{acc * 100:.1f}%"


def format_metrics_line(m: CandidateMetrics, *, mode: Mode, horizon: Horizon) -> str:
    allowed = m.swing_allowed if mode == "swing" else m.day_allowed
    blocked = m.swing_blocked if mode == "swing" else m.day_blocked
    block_rate = m.swing_block_rate() if mode == "swing" else m.day_block_rate()
    cfg = m.config
    return (
        f"{cfg.normal_enter:>4.0f}/{cfg.elevated_enter:>4.0f}/{cfg.crisis_enter:>4.0f} | "
        f"n={m.rows_with_vix:>4} | "
        f"allow {format_accuracy(allowed.accuracy)} ({allowed.correct}/{allowed.resolved_directional}) | "
        f"block {format_accuracy(blocked.accuracy)} ({blocked.correct}/{blocked.resolved_directional}) | "
        f"blk% {format_accuracy(block_rate) if block_rate == block_rate else '—':>6} | "
        f"tierΔ {format_accuracy(m.tier_agreement_pct)}"
    )

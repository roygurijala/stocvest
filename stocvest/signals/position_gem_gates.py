"""Position gem gates (G1-G9), gem_rank, and tier resolver — ADR-004 POS-D15.

Pure and deterministic: every gem tier and rank derives only from a position
composite response body (the six/seven-layer stack + F1-F5 fundamentals pillars).
No network, no LLM — this is the glass-box screening logic that ranks candidates
for the ``GET /v1/signals/position/candidates`` API and ``/dashboard/invest``.

Legal framing: a "gem candidate" has passed internal quality gates for
*informational screening only* — never a recommendation or solicitation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from stocvest.signals.position_universe_filter import passes_position_universe_filter

# ---------------------------------------------------------------------------
# Constants (v1 defaults — Secrets-tunable when POS-D15 batch scales)
# ---------------------------------------------------------------------------

GEM_GATE_IDS: tuple[str, ...] = ("G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9")

FUNDAMENTALS_STRENGTH_MIN = 72
PILLAR_FLOOR = 60
SHARP_BREAKDOWN_PCT_FROM_HIGH = -25.0

PILLAR_IDS: tuple[str, ...] = ("F1", "F2", "F3", "F4", "F5")

TIER_GEM = "gem"
TIER_STRONG = "strong"
TIER_MONITOR = "monitor"
TIER_INSUFFICIENT = "insufficient"

# Regimes that make the long-horizon environment hostile (G7).
_AVOID_REGIMES = {"avoid", "bear", "risk_off", "risk_off_extreme"}

# F3 solvency red-flag chip markers (see f3_balance_sheet.py red_flags list).
_F3_RED_FLAG_MARKERS = ("interest coverage below", "elevated leverage")
# F5 accruals red-flag chip marker (see f5_earnings_quality.py).
_F5_ACCRUAL_MARKER = "high accruals"

_GEM_LAYER_NEUTRAL = 50.0

_TIER_ORDER = {TIER_GEM: 0, TIER_STRONG: 1, TIER_MONITOR: 2, TIER_INSUFFICIENT: 3}


# ---------------------------------------------------------------------------
# Feature extraction (composite body -> normalized, testable struct)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PillarFeature:
    pillar_id: str
    label: str
    score: int | None
    verdict: str
    data_quality: str
    status: str
    chips: tuple[str, ...]


@dataclass(frozen=True)
class CandidateFeatures:
    symbol: str
    status: str
    composite_score: int | None
    verdict: str
    fundamentals_score: int | None
    fundamentals_verdict: str
    fundamentals_data_quality: str
    weakest_pillar_id: str | None
    pillars: dict[str, PillarFeature]
    technical_score: int | None
    technical_verdict: str
    above_sma200: bool | None
    in_base: bool
    pct_from_52w_high: float | None
    rs_vs_spy_6m_pct: float | None
    sector_score: int | None
    sector_verdict: str
    macro_score: int | None
    macro_verdict: str
    regime: str
    signal_valid_days: int | None
    # POS-D11 universe hygiene inputs (optional — absent in the curated v1 large-cap body,
    # threaded in when the full POS-D15 batch carries reference financials).
    company_name: str | None = None
    market_cap: float | None = None
    avg_dollar_volume: float | None = None


def _layer_row(body: dict[str, Any], layer: str) -> dict[str, Any]:
    for row in body.get("layers") or []:
        if isinstance(row, dict) and str(row.get("layer") or "").strip().lower() == layer:
            return row
    return {}


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _chip_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(c) for c in value if str(c).strip())


def _resolve_above_sma200(chips: tuple[str, ...]) -> bool | None:
    """True/False from the weekly (preferred) or daily-confirm SMA200 chip; None if absent."""
    for chip in chips:
        low = chip.lower()
        if "above w-sma200" in low or "above d-sma200" in low:
            return True
        if "below w-sma200" in low or "below d-sma200" in low:
            return False
    return None


def extract_candidate_features(body: dict[str, Any]) -> CandidateFeatures:
    """Normalize a position composite body into gate-ready features (pure)."""
    symbol = str(body.get("symbol") or "").strip().upper()
    status = str(body.get("status") or "active").strip().lower()

    fund = body.get("position_fundamentals")
    fund = fund if isinstance(fund, dict) else {}
    pillars: dict[str, PillarFeature] = {}
    for p in fund.get("pillars") or []:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("pillar_id") or "").strip().upper()
        if not pid:
            continue
        pillars[pid] = PillarFeature(
            pillar_id=pid,
            label=str(p.get("label") or pid),
            score=_as_int(p.get("score")),
            verdict=str(p.get("verdict") or "neutral").strip().lower(),
            data_quality=str(p.get("data_quality") or "unavailable").strip().lower(),
            status=str(p.get("status") or "unavailable").strip().lower(),
            chips=_chip_tuple(p.get("chips")),
        )

    tech_row = _layer_row(body, "technical")
    tech_snap = tech_row.get("indicator_snapshot")
    tech_snap = tech_snap if isinstance(tech_snap, dict) else {}
    tech_chips = _chip_tuple(tech_row.get("chips"))
    above_sma200 = _resolve_above_sma200(tech_chips)

    sector_row = _layer_row(body, "sector")
    macro_row = _layer_row(body, "macro")

    return CandidateFeatures(
        symbol=symbol,
        status=status,
        composite_score=_as_int(body.get("score")),
        verdict=str(body.get("verdict") or body.get("signal_summary") or "neutral").strip().lower(),
        fundamentals_score=_as_int(fund.get("score")),
        fundamentals_verdict=str(fund.get("verdict") or "neutral").strip().lower(),
        fundamentals_data_quality=str(fund.get("data_quality") or "unavailable").strip().lower(),
        weakest_pillar_id=(str(fund.get("weakest_pillar_id")).strip().upper() if fund.get("weakest_pillar_id") else None),
        pillars=pillars,
        technical_score=_as_int(tech_row.get("score")),
        technical_verdict=str(tech_row.get("verdict") or "neutral").strip().lower(),
        above_sma200=above_sma200,
        in_base=bool(tech_snap.get("in_base")),
        pct_from_52w_high=_as_float(tech_snap.get("pct_from_52w_high")),
        rs_vs_spy_6m_pct=_as_float(tech_snap.get("rs_vs_spy_6m_pct")),
        sector_score=_as_int(sector_row.get("score")),
        sector_verdict=str(sector_row.get("verdict") or "neutral").strip().lower(),
        macro_score=_as_int(macro_row.get("score")),
        macro_verdict=str(macro_row.get("verdict") or "neutral").strip().lower(),
        regime=str(body.get("regime") or body.get("market_regime") or "").strip().lower(),
        signal_valid_days=_as_int(body.get("signal_valid_days")),
        company_name=(str(body.get("company_name")).strip() or None) if body.get("company_name") else None,
        market_cap=_as_float(body.get("market_cap")),
        avg_dollar_volume=_as_float(body.get("avg_dollar_volume") or body.get("dollar_volume")),
    )


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------


def _pillar_scores(f: CandidateFeatures) -> dict[str, int | None]:
    return {pid: (f.pillars[pid].score if pid in f.pillars else None) for pid in PILLAR_IDS}


def min_pillar_score(f: CandidateFeatures) -> int | None:
    present = [s for s in _pillar_scores(f).values() if s is not None]
    return min(present) if present else None


def _has_flag(chips: tuple[str, ...], markers: tuple[str, ...]) -> bool:
    for chip in chips:
        low = chip.lower()
        if any(m in low for m in markers):
            return True
    return False


def evaluate_gem_gates(
    f: CandidateFeatures,
    *,
    rs_bottom_quartile_threshold: float | None = None,
) -> dict[str, bool]:
    """Evaluate G1-G9 for one candidate. Missing inputs fail conservatively."""
    p = _pillar_scores(f)
    f1, f2, f3, f4, f5 = (f.pillars.get(pid) for pid in PILLAR_IDS)

    # G1 — Fundamentals strength: layer >= 72 AND each F1-F5 >= 60 (no weak link).
    g1 = (
        f.fundamentals_score is not None
        and f.fundamentals_score >= FUNDAMENTALS_STRENGTH_MIN
        and all(s is not None and s >= PILLAR_FLOOR for s in p.values())
    )

    # G2 — Earnings quality: F5 scored, not bearish, no accruals red flag.
    g2 = bool(
        f5 and f5.score is not None and f5.verdict != "bearish"
        and not _has_flag(f5.chips, (_F5_ACCRUAL_MARKER,))
    )

    # G3 — Balance sheet: F3 scored, bullish/neutral, no solvency red-flag chip.
    g3 = bool(
        f3 and f3.score is not None and f3.verdict in ("bullish", "neutral")
        and not _has_flag(f3.chips, _F3_RED_FLAG_MARKERS)
    )

    # G4 — Valuation sanity: F4 not bearish unless F1+F2 both bullish (quality compounder).
    if f4 is None:
        g4 = False
    elif f4.verdict != "bearish":
        g4 = True
    else:
        g4 = bool(f1 and f2 and f1.verdict == "bullish" and f2.verdict == "bullish")

    # G5 — Structural trend: above SMA200 or in base; not in sharp breakdown.
    trend_ok = bool(f.above_sma200) or f.in_base
    breakdown = (
        f.pct_from_52w_high is not None and f.pct_from_52w_high <= SHARP_BREAKDOWN_PCT_FROM_HIGH
    )
    g5 = trend_ok and not breakdown and f.technical_verdict != "bearish"

    # G6 — Relative strength: RS 6M vs SPY not bottom quartile of scan universe.
    if rs_bottom_quartile_threshold is None or f.rs_vs_spy_6m_pct is None:
        g6 = True  # degrade gracefully when universe distribution is unavailable
    else:
        g6 = f.rs_vs_spy_6m_pct > rs_bottom_quartile_threshold

    # G7 — Macro / sector: regime not avoid; sector not strongly bearish.
    g7 = f.regime not in _AVOID_REGIMES and f.sector_verdict != "bearish"

    # G8 — Universe hygiene: passes position_universe_filter (POS-D11). Blocks leveraged/
    # inverse ETFs and SPAC shells (symbol/name based, always enforced) plus configurable
    # micro-cap / illiquidity floors when reference financials are available.
    g8 = passes_position_universe_filter(
        f.symbol,
        company_name=f.company_name,
        market_cap=f.market_cap,
        avg_dollar_volume=f.avg_dollar_volume,
    )

    # G9 — Data quality: layer data_quality >= medium and >= 4 pillars medium+.
    dq_ok = f.fundamentals_data_quality in ("high", "medium")
    strong_pillars = sum(1 for pf in f.pillars.values() if pf.data_quality in ("high", "medium"))
    g9 = dq_ok and strong_pillars >= 4

    return {
        "G1": g1,
        "G2": g2,
        "G3": g3,
        "G4": g4,
        "G5": g5,
        "G6": g6,
        "G7": g7,
        "G8": g8,
        "G9": g9,
    }


def failing_gates(gates: dict[str, bool]) -> list[str]:
    return [gid for gid in GEM_GATE_IDS if not gates.get(gid, False)]


def compute_gem_rank(f: CandidateFeatures) -> float:
    """Transparent weighted rank within the qualified set (0-100).

    gem_rank = 0.45*fundamentals + 0.20*technical + 0.15*sector + 0.10*macro
               + 0.10*min(F1..F5). Missing supporting layers count as neutral.
    """
    fund = float(f.fundamentals_score) if f.fundamentals_score is not None else 0.0
    tech = float(f.technical_score) if f.technical_score is not None else _GEM_LAYER_NEUTRAL
    sector = float(f.sector_score) if f.sector_score is not None else _GEM_LAYER_NEUTRAL
    macro = float(f.macro_score) if f.macro_score is not None else _GEM_LAYER_NEUTRAL
    mp = min_pillar_score(f)
    min_p = float(mp) if mp is not None else 0.0
    rank = 0.45 * fund + 0.20 * tech + 0.15 * sector + 0.10 * macro + 0.10 * min_p
    return round(max(0.0, min(100.0, rank)), 2)


def resolve_gem_tier(f: CandidateFeatures, gates: dict[str, bool]) -> str:
    if f.status == "insufficient_data" or f.fundamentals_score is None:
        return TIER_INSUFFICIENT
    # POS-D11: a failed universe filter (leveraged/inverse, SPAC shell, micro-cap/illiquid)
    # is not investable — never surfaced, regardless of fundamentals.
    if not gates.get("G8", False):
        return TIER_INSUFFICIENT
    if all(gates.get(gid, False) for gid in GEM_GATE_IDS):
        return TIER_GEM
    strong_core = all(gates.get(gid, False) for gid in ("G1", "G2", "G3", "G8", "G9"))
    misses_environment = not (gates.get("G5") and gates.get("G6") and gates.get("G7"))
    if strong_core and misses_environment:
        return TIER_STRONG
    return TIER_MONITOR


def build_gem_why(f: CandidateFeatures, gates: dict[str, bool], tier: str) -> str:
    """One-line, non-advisory rationale for the candidate row."""
    weak = f.pillars.get(f.weakest_pillar_id) if f.weakest_pillar_id else None
    weak_txt = (
        f"weakest {f.weakest_pillar_id} {weak.label.lower()}"
        if weak is not None
        else "review pillars"
    )
    if tier == TIER_GEM:
        return f"Passes strict quality gates — {weak_txt}. Screening only."
    if tier == TIER_STRONG:
        missing = [g for g in ("G5", "G6", "G7") if not gates.get(g)]
        env = {
            "G5": "structural trend",
            "G6": "relative strength",
            "G7": "macro/sector environment",
        }
        missing_txt = ", ".join(env[g] for g in missing) or "environment"
        return f"Strong fundamentals; {missing_txt} needs review. Screening only."
    if tier == TIER_INSUFFICIENT:
        if not gates.get("G8", False):
            return "Excluded by universe hygiene (leveraged/inverse, SPAC, or micro-cap/illiquid) — not screened."
        return "Insufficient fundamentals coverage — not screened."
    fails = failing_gates(gates)
    return f"Mixed read — {weak_txt} (gates missed: {', '.join(fails) or 'none'})."


def tier_sort_key(tier: str) -> int:
    return _TIER_ORDER.get(tier, 99)

"""Daily portfolio review — per-holding Hold / Buy-more / Trim / Sell + context.

STOCVEST-manages-my-portfolio (Slice 2 engine). Given a user's manually-entered
holdings + settings, produce a per-holding recommendation plus portfolio-level
context (concentration flags, benchmark-vs-SPY, and a "consider adding" list).

**Signal-first (per the operator's decision):** each holding's directional action
is driven by the Long-Term composite *verdict* + the position *holder-read* stance
— both already computed by the existing desk engine
(:func:`build_position_composite_response` / :func:`build_position_holder_read`).
Cost-basis P/L, target-weight concentration, and tax-lot holding period are layered
as **secondary** context: they refine sizing (how much to add / trim) and add flags,
but never flip the desk's directional read.

No indicator math is invented here (see .cursorrules §8):
- verdict + stance come straight from the composite engine,
- the "overweight" test uses the *effective* target — the user's own
  ``target_position_pct`` when set, else personal-mode **conviction sleeves**
  (core 10–15 / standard 6–9 / vehicle 4–6 / exit 0–3; single-name max 15)
  mapped from verdict, stance, structure-broken, and fund-vehicle (never written
  back to settings; operator-agreed policy, not ticker weights),
- the "long-term lot" test uses the model's existing >365-day rule.

Everything network-touching is dependency-injected (``compose_fn``, ``snapshot_fn``,
``spy_bars_fn``, ``scan_fn``, ``ai_read_fn``) so the derivation/ranking logic is
unit-testable offline — mirroring ``position_scan.py``.

Privacy: prices, cost basis, and cash are financial data — this module never logs
them (see ``stocvest/utils/log_privacy.py`` rule). Only symbols/actions are logged.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Awaitable, Callable

from stocvest.api.services.portfolio_sleeve_policy import (
    SLEEVE_POLICY_SUMMARY,
    SleevePolicy,
    resolve_sleeve_policy,
    scale_sleeve_policies,
    weight_vs_sleeve,
)
from stocvest.models.portfolio_holding import PortfolioHolding, PortfolioSettings
from stocvest.signals.position_holder_read import build_position_holder_read
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_REVIEW_DISCLAIMER = (
    "Informational review of a personal, manually-entered portfolio — not personalized "
    "investment advice. Signal data only; you are responsible for your own decisions."
)

# Header one-liner: sleeve bands + the already-shipped stance overlay.
_SIZING_RULE = SLEEVE_POLICY_SUMMARY

# Dependency-injection function types.
ComposeFn = Callable[[str], Awaitable[dict[str, Any]]]
SnapshotFn = Callable[[list[str]], Awaitable[dict[str, Any]]]
SpyBarsFn = Callable[[str, date], Awaitable[list[Any]]]
ScanFn = Callable[[], list[Any]]
AiReadFn = Callable[[str, dict[str, Any]], Awaitable[str | None]]


class ReviewAction(str, Enum):
    """The deterministic per-holding recommendation."""

    BUY_MORE = "buy_more"
    HOLD = "hold"
    TRIM = "trim"
    SELL = "sell"
    REVIEW = "review"  # not enough signal data to read the position


_ACTION_LABELS: dict[ReviewAction, str] = {
    ReviewAction.BUY_MORE: "Buy more",
    ReviewAction.HOLD: "Hold",
    ReviewAction.TRIM: "Trim",
    ReviewAction.SELL: "Sell",
    ReviewAction.REVIEW: "Review — insufficient signal data",
}


# ──────────────────────────────────────────────────────────────────────────────
# Pure helpers (no network, no invented thresholds)
# ──────────────────────────────────────────────────────────────────────────────

def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def resolve_current_price(snap: Any) -> float | None:
    """Best available mark price from a Snapshot: last trade → day close → prev close.

    Mirrors the frontend resolver so the backend review and the on-screen table agree.
    Returns ``None`` when nothing usable is present (position is then valued at cost,
    with a *null* — never a fake $0 — unrealized P/L).
    """
    if snap is None:
        return None
    for attr in ("last_trade_price", "day_close", "prev_close"):
        val = _num(getattr(snap, attr, None))
        if val is not None and val > 0:
            return val
    return None


def resolve_effective_target_pct(
    *,
    explicit_target_pct: float | None,
    holding_count: int,
    advice_enabled: bool,
) -> tuple[float | None, bool]:
    """``(explicit_pct_or_none, uses_default_policy)``.

    Explicit settings win (one point target for every name). Personal mode + null
    target → ``(None, True)`` meaning **per-holding conviction sleeves** (not a
    single equal-weight pct). Product mode + null → ``(None, False)`` — no amounts.
    ``holding_count`` is accepted for call-site compatibility; sleeves do not use it.
    """
    _ = holding_count
    if explicit_target_pct is not None:
        return float(explicit_target_pct), False
    if advice_enabled:
        return None, True
    return None, False


def suggested_add_amount(
    market_value: float,
    total_value: float,
    target_pct: float | None,
    cash_available: float,
) -> float | None:
    """Dollar amount to lift a position toward its target weight, capped by cash.

    ``None`` when no target is set (guidance stays directional, no amount). ``0.0``
    when the position is already at/over its target weight or there is no cash. Uses
    the *effective* ``target_pct`` (explicit or personal default) — no invented sizing.
    """
    if target_pct is None or total_value <= 0:
        return None
    target_value = (target_pct / 100.0) * total_value
    gap = target_value - market_value
    if gap <= 0:
        return 0.0
    return round(min(gap, max(0.0, cash_available)), 2)


def suggested_reduce_amount(
    market_value: float,
    total_value: float,
    target_pct: float | None,
) -> float | None:
    """Dollar amount to bring an *overweight* position back down to its target weight.

    ``None`` when no target is set or the position is not overweight (the action stays
    directional — "reduce exposure" — without inventing a trim size). Excess only;
    never a 50% winner trim or a made-up residual weight.
    """
    if target_pct is None or total_value <= 0:
        return None
    target_value = (target_pct / 100.0) * total_value
    excess = market_value - target_value
    if excess <= 0:
        return None
    return round(excess, 2)


def apply_stance_sizing(
    *,
    action: ReviewAction,
    overweight: bool,
    add_gap: float | None,
    reduce_excess: float | None,
    market_value: float,
    cash_available: float | None = None,
) -> tuple[ReviewAction, float | None, float | None, str | None]:
    """Stance overlay on gap math. Returns ``(action, add, reduce, extra_rationale)``.

    Uses existing desk actions only — no new numeric thresholds:
    - ``buy_more`` / constructive → fill the underweight gap (cash-capped add)
    - ``hold`` / ``buy_more`` + already over target → TRIM the excess only
    - ``hold`` + under target (caution / thin R/R) → no add
    - ``trim`` → excess toward target, not to zero
    - ``sell`` → full market value, not a made-up 75%
    - ``review`` → directional only; never emit add/reduce
    """
    if action == ReviewAction.REVIEW:
        return action, None, None, None

    if action == ReviewAction.BUY_MORE:
        if add_gap is None:
            return action, None, None, None
        if add_gap <= 0:
            if cash_available is not None and cash_available <= 0 and not overweight:
                extra = "No cash available to add toward target — holding rather than adding."
                return ReviewAction.HOLD, None, None, extra
            if overweight:
                extra = "Already over target weight — trimming the excess rather than adding."
                return ReviewAction.TRIM, None, reduce_excess, extra
            extra = (
                "Already at/over target weight (or no cash available) — holding rather than adding."
            )
            return ReviewAction.HOLD, None, None, extra
        return action, add_gap, None, None

    if action == ReviewAction.HOLD:
        if overweight:
            return ReviewAction.TRIM, None, reduce_excess, None
        return action, None, None, None

    if action == ReviewAction.TRIM:
        return action, None, reduce_excess, None

    if action == ReviewAction.SELL:
        full_mv = round(market_value, 2) if market_value > 0 else None
        return action, None, full_mv, None

    return action, None, None, None


def unfilled_gap_dollars(
    *,
    target_pct: float | None,
    weight_pct: float | None,
    portfolio_value: float,
) -> float | None:
    """Informational ``(target − weight) × portfolioValue``. Never a suggested add."""
    if target_pct is None or weight_pct is None or portfolio_value <= 0:
        return None
    gap = (target_pct - weight_pct) / 100.0 * portfolio_value
    if gap <= 0:
        return None
    return round(gap, 2)


def _fmt_target_pct(target: float) -> str:
    return f"~{target:.1f}%"


def _fmt_gap_dollars(gap: float) -> str:
    return f"~${gap:,.2f}"


def sizing_reason(
    *,
    action: ReviewAction,
    target_pct: float | None,
    weight_pct: float | None,
    suggested_add: float | None,
    suggested_reduce: float | None,
    portfolio_value: float,
    stance: str | None = None,
    sleeve: SleevePolicy | None = None,
) -> str:
    """Short deterministic sentence for why add/reduce is (or is not) set.

    Does not change amounts — copy only. Sleeve bands: add toward the floor,
    trim to the high. Explicit point target uses the old single-number copy.
    """
    has_add = suggested_add is not None and suggested_add > 0
    has_reduce = suggested_reduce is not None and suggested_reduce > 0
    add_edge = sleeve.low_pct if sleeve is not None else target_pct
    trim_edge = sleeve.high_pct if sleeve is not None else target_pct
    under = (
        add_edge is not None
        and weight_pct is not None
        and weight_pct < add_edge
    )
    over = (
        trim_edge is not None
        and weight_pct is not None
        and weight_pct > trim_edge
    )
    in_band = (
        sleeve is not None
        and weight_pct is not None
        and sleeve.low_pct <= weight_pct <= sleeve.high_pct
    )
    caution = (stance or "").strip().lower() == "caution"
    target_label = (
        f"the {sleeve.label} {sleeve.band_phrase()} sleeve"
        if sleeve is not None
        else (f"the {_fmt_target_pct(target_pct)} target" if target_pct is not None else "the target")
    )
    floor_label = (
        f"the {sleeve.label} {_fmt_target_pct(sleeve.low_pct)} sleeve floor"
        if sleeve is not None
        else (f"the {_fmt_target_pct(target_pct)} target" if target_pct is not None else "the target")
    )
    high_label = (
        f"the {sleeve.label} {_fmt_target_pct(sleeve.high_pct)} sleeve"
        if sleeve is not None
        else (f"the {_fmt_target_pct(target_pct)} target" if target_pct is not None else "the target")
    )

    if action == ReviewAction.SELL and has_reduce and under:
        return (
            "Sell overrides the target: reducing the full position even though "
            f"weight is below {target_label}."
        )
    if action == ReviewAction.HOLD and under and not has_add and caution:
        gap = unfilled_gap_dollars(
            target_pct=add_edge,
            weight_pct=weight_pct,
            portfolio_value=portfolio_value,
        )
        if gap is not None:
            gap_noun = "floor" if sleeve is not None else "target"
            return (
                f"Hold + caution: not adding toward {floor_label} "
                f"(thin R/R). Gap to {gap_noun} would be {_fmt_gap_dollars(gap)}."
            )
    if action in (ReviewAction.HOLD, ReviewAction.TRIM) and over and has_reduce:
        return f"Over {high_label} — trimming the excess only."
    if action == ReviewAction.BUY_MORE and has_add:
        return f"Under {floor_label} — adding the gap (cash-capped)."
    if in_band and not has_add and not has_reduce:
        return f"Inside {target_label}."
    if target_pct is not None and not has_add and not has_reduce and not under and not over:
        return f"At the {_fmt_target_pct(target_pct)} target"
    return "No size change."


def _target_weight_phrase(
    target: float,
    *,
    used_default: bool,
    sleeve: SleevePolicy | None = None,
) -> str:
    if sleeve is not None:
        return f"the {sleeve.label} {sleeve.band_phrase()} sleeve"
    if used_default:
        return f"the default ~{target:.1f}% target"
    return f"your {target:.1f}% target"


def derive_action(
    *,
    verdict: str,
    holder_stance: str | None,
    status: str,
) -> ReviewAction:
    """Signal-first base action from the composite verdict + holder-read stance.

    - insufficient data / no verdict → REVIEW
    - bullish + constructive stance   → BUY_MORE (sizing decides if it survives)
    - bullish (non-constructive)      → HOLD
    - neutral                         → HOLD
    - bearish + defensive stance      → SELL
    - bearish (non-defensive)         → TRIM
    """
    status_l = (status or "").strip().lower()
    verdict_l = (verdict or "").strip().lower()
    stance_l = (holder_stance or "").strip().lower()

    if status_l == "insufficient_data" or verdict_l not in ("bullish", "bearish", "neutral"):
        return ReviewAction.REVIEW

    if verdict_l == "bullish":
        return ReviewAction.BUY_MORE if stance_l == "constructive" else ReviewAction.HOLD
    if verdict_l == "bearish":
        return ReviewAction.SELL if stance_l == "defensive" else ReviewAction.TRIM
    return ReviewAction.HOLD


def tax_lot_hint(
    holding: PortfolioHolding,
    action: ReviewAction,
    *,
    as_of: date | None = None,
) -> tuple[str | None, int, int]:
    """(hint, long_term_lots, short_term_lots) for a trim/sell.

    When selling, prefer long-term lots (held > 1 year) for favorable long-term
    capital-gains treatment. Uses the model's existing >365-day rule — no new math.
    The hint is only produced for TRIM/SELL and only when there is a lot mix worth
    calling out.
    """
    lt = sum(1 for lot in holding.lots if lot.is_long_term(as_of=as_of))
    st = len(holding.lots) - lt
    if action not in (ReviewAction.TRIM, ReviewAction.SELL):
        return None, lt, st
    if lt > 0 and st > 0:
        hint = (
            f"For tax efficiency, prefer selling the {lt} long-term lot(s) "
            f"(held > 1 year) over the {st} short-term lot(s)."
        )
    elif lt > 0:
        hint = f"All {lt} lot(s) are long-term (held > 1 year) — sales qualify for long-term rates."
    elif st > 0:
        hint = (
            f"All {st} lot(s) are short-term (held ≤ 1 year) — a sale would be taxed as a "
            "short-term gain; weigh waiting for the long-term threshold if the thesis allows."
        )
    else:
        hint = None
    return hint, lt, st


def compute_benchmark_comparison(
    *,
    lots: list[tuple[float, str]],
    spy_close_on: Callable[[date], float | None],
    spy_current: float | None,
    benchmark_symbol: str,
) -> "BenchmarkComparison":
    """Money-weighted portfolio-vs-benchmark return.

    For each lot (cost dollars, purchase date) we buy hypothetical ``benchmark``
    shares at the benchmark's close on the purchase date and value them at the
    current benchmark price. Comparing the summed benchmark value to the portfolio's
    actual value answers "would I have done better just buying SPY?" on a
    like-for-like, timing-matched basis.
    """
    if not lots or spy_current is None or spy_current <= 0:
        return BenchmarkComparison(
            benchmark_symbol=benchmark_symbol,
            invested_cost=0.0,
            benchmark_value=None,
            benchmark_return_pct=None,
            note="Benchmark comparison unavailable (missing benchmark price history).",
        )

    invested_cost = 0.0
    benchmark_value = 0.0
    covered = 0
    for cost, purchase_iso in lots:
        invested_cost += cost
        try:
            pdate = date.fromisoformat(purchase_iso[:10])
        except (ValueError, TypeError):
            continue
        entry_px = spy_close_on(pdate)
        if entry_px is None or entry_px <= 0:
            continue
        benchmark_value += (cost / entry_px) * spy_current
        covered += 1

    if covered == 0 or invested_cost <= 0:
        return BenchmarkComparison(
            benchmark_symbol=benchmark_symbol,
            invested_cost=round(invested_cost, 2),
            benchmark_value=None,
            benchmark_return_pct=None,
            note="Benchmark comparison unavailable (no matching benchmark closes for purchase dates).",
        )

    benchmark_return_pct = round((benchmark_value - invested_cost) / invested_cost * 100.0, 2)
    note = (
        f"Not year-to-date. Same dollars invested in {benchmark_symbol} "
        "on each of your purchase dates."
    )
    if covered < len(lots):
        note += f" ({covered} of {len(lots)} lots matched a benchmark close.)"
    return BenchmarkComparison(
        benchmark_symbol=benchmark_symbol,
        invested_cost=round(invested_cost, 2),
        benchmark_value=round(benchmark_value, 2),
        benchmark_return_pct=benchmark_return_pct,
        note=note,
    )


def build_owner_position_context(
    *,
    body: dict[str, Any],
    holding: PortfolioHolding,
    current_price: float | None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Owner-oriented context for a deep-dive of a symbol the caller *already holds*.

    Attached to the Long-Term composite body (snake_case, like the other ``position_*``
    payloads) so the deep-dive can show YOUR cost basis, unrealized P/L, tax
    holding-period, and the signal-first action — using the same verdict + holder-read
    the review uses. Pure/deterministic; no network, no invented thresholds.
    """
    as_of = as_of or datetime.now(timezone.utc).date()
    status = str(body.get("status") or "").strip().lower()
    verdict = str(body.get("signal_summary") or body.get("verdict") or "").strip().lower()
    holder_read = build_position_holder_read(body)
    stance = str((holder_read or {}).get("stance") or "").strip().lower() or None
    action = derive_action(verdict=verdict, holder_stance=stance, status=status)

    qty = holding.total_quantity
    avg = holding.average_cost
    if current_price is not None and avg is not None:
        market_value = round(qty * current_price, 2)
        unrealized_pl = round((current_price - avg) * qty, 2)
        unrealized_pl_pct = round((current_price - avg) / avg * 100.0, 2) if avg > 0 else None
    else:
        market_value = round(qty * (avg or 0.0), 2)
        unrealized_pl = None
        unrealized_pl_pct = None

    hint, lt, st = tax_lot_hint(holding, action, as_of=as_of)

    return {
        "symbol": holding.symbol,
        "quantity": qty,
        "average_cost": avg,
        "current_price": current_price,
        "market_value": market_value,
        "unrealized_pl": unrealized_pl,
        "unrealized_pl_pct": unrealized_pl_pct,
        "action": action.value,
        "action_label": _ACTION_LABELS[action],
        "holder_stance": stance,
        "tax_lot_hint": hint,
        "long_term_lots": lt,
        "short_term_lots": st,
        "lot_count": len(holding.lots),
        "earliest_purchase_date": holding.earliest_purchase_date(),
        "disclaimer": _REVIEW_DISCLAIMER,
    }


def _build_spy_close_lookup(bars: list[Any]) -> Callable[[date], float | None]:
    """Return an 'on-or-before' close lookup from daily bars (weekends/holidays safe)."""
    by_date: list[tuple[date, float]] = []
    for bar in bars:
        ts = getattr(bar, "timestamp", None)
        close = _num(getattr(bar, "close", None))
        if ts is None or close is None or close <= 0:
            continue
        bdate = ts.date() if isinstance(ts, datetime) else ts
        by_date.append((bdate, close))
    by_date.sort(key=lambda x: x[0])

    def _lookup(target: date) -> float | None:
        found: float | None = None
        for bdate, close in by_date:
            if bdate <= target:
                found = close
            else:
                break
        # If the purchase predates our earliest bar, fall back to the earliest close.
        if found is None and by_date:
            return by_date[0][1]
        return found

    return _lookup


# ──────────────────────────────────────────────────────────────────────────────
# Output dataclasses
# ──────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HoldingReview:
    symbol: str
    quantity: float
    average_cost: float | None
    current_price: float | None
    market_value: float | None
    unrealized_pl: float | None
    unrealized_pl_pct: float | None
    weight_pct: float | None
    verdict: str
    confidence: float | None
    action: ReviewAction
    rationale: list[str]
    overweight: bool
    suggested_add_amount: float | None = None
    suggested_reduce_amount: float | None = None
    sizing_reason: str | None = None
    driver_line: str | None = None
    effective_target_pct: float | None = None
    sleeve: str | None = None
    sleeve_low_pct: float | None = None
    sleeve_high_pct: float | None = None
    tax_lot_hint: str | None = None
    long_term_lots: int = 0
    short_term_lots: int = 0
    holder_read: dict[str, Any] | None = None
    ai_read: str | None = None
    is_fund_vehicle: bool = False

    def to_api(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "quantity": self.quantity,
            "averageCost": self.average_cost,
            "currentPrice": self.current_price,
            "marketValue": self.market_value,
            "unrealizedPl": self.unrealized_pl,
            "unrealizedPlPct": self.unrealized_pl_pct,
            "weightPct": self.weight_pct,
            "verdict": self.verdict,
            "confidence": self.confidence,
            "action": self.action.value,
            "actionLabel": _ACTION_LABELS[self.action],
            "rationale": list(self.rationale),
            "overweight": self.overweight,
            "suggestedAddAmount": self.suggested_add_amount,
            "suggestedReduceAmount": self.suggested_reduce_amount,
            "sizingReason": self.sizing_reason,
            "driverLine": self.driver_line,
            "effectiveTargetPct": self.effective_target_pct,
            "sleeve": self.sleeve,
            "sleeveLowPct": self.sleeve_low_pct,
            "sleeveHighPct": self.sleeve_high_pct,
            "taxLotHint": self.tax_lot_hint,
            "longTermLots": self.long_term_lots,
            "shortTermLots": self.short_term_lots,
            "holderRead": self.holder_read,
            "aiRead": self.ai_read,
            "isFundVehicle": self.is_fund_vehicle,
        }


@dataclass(frozen=True)
class ConcentrationFlag:
    symbol: str
    weight_pct: float
    target_pct: float | None
    message: str

    def to_api(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "weightPct": self.weight_pct,
            "targetPct": self.target_pct,
            "message": self.message,
        }


@dataclass(frozen=True)
class ConsiderAddCandidate:
    symbol: str
    tier: str
    verdict: str
    why: str
    sleeve: str | None = None
    sleeve_low_pct: float | None = None
    sleeve_high_pct: float | None = None
    target_pct: float | None = None
    suggested_add_amount: float | None = None
    sizing_reason: str | None = None
    driver_line: str | None = None

    def to_api(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "tier": self.tier,
            "verdict": self.verdict,
            "why": self.why,
            "sleeve": self.sleeve,
            "sleeveLowPct": self.sleeve_low_pct,
            "sleeveHighPct": self.sleeve_high_pct,
            "targetPct": self.target_pct,
            "suggestedAddAmount": self.suggested_add_amount,
            "sizingReason": self.sizing_reason,
            "driverLine": self.driver_line,
        }


@dataclass(frozen=True)
class BenchmarkComparison:
    benchmark_symbol: str
    invested_cost: float
    benchmark_value: float | None
    benchmark_return_pct: float | None
    note: str

    def to_api(self) -> dict[str, Any]:
        return {
            "benchmarkSymbol": self.benchmark_symbol,
            "investedCost": self.invested_cost,
            "benchmarkValue": self.benchmark_value,
            "benchmarkReturnPct": self.benchmark_return_pct,
            "note": self.note,
        }


@dataclass(frozen=True)
class PortfolioReview:
    generated_at: datetime
    holdings: list[HoldingReview] = field(default_factory=list)
    total_market_value: float = 0.0
    invested_value: float = 0.0
    cash_balance: float = 0.0
    total_cost: float = 0.0
    unrealized_pl: float | None = None
    unrealized_pl_pct: float | None = None
    portfolio_return_pct: float | None = None
    concentration: list[ConcentrationFlag] = field(default_factory=list)
    consider_adding: list[ConsiderAddCandidate] = field(default_factory=list)
    benchmark: BenchmarkComparison | None = None
    fully_priced: bool = True
    effective_target_pct: float | None = None
    target_is_default: bool = False
    sizing_policy: str | None = None

    def to_api(self) -> dict[str, Any]:
        return {
            "generatedAt": self.generated_at.replace(microsecond=0).isoformat(),
            "holdings": [h.to_api() for h in self.holdings],
            "totalMarketValue": round(self.total_market_value, 2),
            "investedValue": round(self.invested_value, 2),
            "cashBalance": round(self.cash_balance, 2),
            "totalCost": round(self.total_cost, 2),
            "unrealizedPl": (round(self.unrealized_pl, 2) if self.unrealized_pl is not None else None),
            "unrealizedPlPct": self.unrealized_pl_pct,
            "portfolioReturnPct": self.portfolio_return_pct,
            "concentration": [c.to_api() for c in self.concentration],
            "considerAdding": [c.to_api() for c in self.consider_adding],
            "benchmark": self.benchmark.to_api() if self.benchmark else None,
            "fullyPriced": self.fully_priced,
            "effectiveTargetPct": self.effective_target_pct,
            "targetIsDefault": self.target_is_default,
            "sizingPolicy": self.sizing_policy,
            "sizingRule": _SIZING_RULE,
            "disclaimer": _REVIEW_DISCLAIMER,
        }


# ──────────────────────────────────────────────────────────────────────────────
# Orchestrator (network via injected fns; pure logic above stays offline-testable)
# ──────────────────────────────────────────────────────────────────────────────

async def build_portfolio_review(
    *,
    holdings: tuple[PortfolioHolding, ...] | list[PortfolioHolding],
    settings: PortfolioSettings,
    user_id: str | None = None,
    user_email: str | None = None,
    compose_fn: ComposeFn | None = None,
    snapshot_fn: SnapshotFn | None = None,
    spy_bars_fn: SpyBarsFn | None = None,
    scan_fn: ScanFn | None = None,
    ai_read_fn: AiReadFn | None = None,
    as_of: date | None = None,
    concurrency: int = 6,
    advice_enabled: bool | None = None,
) -> PortfolioReview:
    """Compose the full daily review. All external data comes through injected fns.

    ``advice_enabled`` gates the *advisory* output (per-holding Buy/Hold/Trim/Sell
    actions, holder-read stance, sizing suggestions, concentration trim flags, and the
    "consider adding" list). It defaults to ``stocvest_personal_advice_mode_enabled``
    (the legal basis for buy/sell language in the single-operator build). When the flag
    is OFF — the required posture before any external release — every action degrades to
    an informational ``REVIEW`` and the advisory extras are suppressed, so only factual
    valuation (P/L, weights, benchmark) is returned.
    """
    _ = (user_id, user_email)  # reserved for AI-read wiring in the endpoint layer
    as_of = as_of or datetime.now(timezone.utc).date()
    if advice_enabled is None:
        from stocvest.utils.config import get_settings

        advice_enabled = bool(get_settings().stocvest_personal_advice_mode_enabled)
    holdings = list(holdings)
    compose = compose_fn or _default_compose
    fetch_snapshots = snapshot_fn or _default_snapshots
    fetch_spy_bars = spy_bars_fn or _default_spy_bars

    target, target_is_default = resolve_effective_target_pct(
        explicit_target_pct=settings.target_position_pct,
        holding_count=len(holdings),
        advice_enabled=advice_enabled,
    )

    sizing_policy = (
        "explicit" if target is not None else ("sleeve" if target_is_default else None)
    )

    if not holdings:
        # Empty book: sleeve policy is named but there is nothing to size.
        return PortfolioReview(
            generated_at=datetime.now(timezone.utc),
            cash_balance=settings.cash_balance,
            total_market_value=settings.cash_balance,
            effective_target_pct=target,
            target_is_default=target_is_default,
            sizing_policy=sizing_policy,
        )

    symbols = [h.symbol for h in holdings]
    bench_sym = settings.benchmark_symbol

    # 1) Mark prices — one batch covering holdings + the benchmark (so the benchmark
    #    price reuses this fetch instead of a second snapshot round-trip) — plus the
    #    per-symbol composite (bounded concurrency).
    price_symbols = symbols + ([bench_sym] if bench_sym not in symbols else [])
    snap_map = await _safe_snapshots(fetch_snapshots, price_symbols)
    bodies = await _compose_all(compose, symbols, concurrency=concurrency)

    # 2) Value each holding; total value includes cash so weights are portfolio-wide.
    priced: list[tuple[PortfolioHolding, float | None, float]] = []  # (holding, price, mkt_value)
    invested_value = 0.0
    total_cost = 0.0
    fully_priced = True
    for h in holdings:
        price = resolve_current_price(snap_map.get(h.symbol))
        if price is None:
            fully_priced = False
            price_for_value = h.average_cost or 0.0
        else:
            price_for_value = price
        mkt_value = round(h.total_quantity * price_for_value, 2)
        invested_value += mkt_value
        total_cost += h.total_cost
        priced.append((h, price, mkt_value))

    total_value = invested_value + settings.cash_balance

    # 3) Resolve sleeves (personal default) then size. Explicit target stays one number.
    draft_rows: list[dict[str, Any]] = []
    raw_sleeves: list[SleevePolicy] = []
    for (h, price, mkt_value), body in zip(priced, bodies):
        body = body if isinstance(body, dict) else {}
        status = str(body.get("status") or "").strip().lower()
        verdict = str(body.get("signal_summary") or body.get("verdict") or "").strip().lower()
        confidence = _num(body.get("signal_strength"))
        holder_read = build_position_holder_read(body) if (body and advice_enabled) else None
        stance = str((holder_read or {}).get("stance") or "").strip().lower() or None
        is_vehicle = body.get("is_fund_vehicle") is True
        structure_broken = body.get("signal_structure_broken") is True
        action = (
            derive_action(verdict=verdict, holder_stance=stance, status=status)
            if advice_enabled
            else ReviewAction.REVIEW
        )
        row_sleeve = (
            resolve_sleeve_policy(
                is_fund_vehicle=is_vehicle,
                verdict=verdict,
                stance=stance,
                structure_broken=structure_broken,
            )
            if sizing_policy == "sleeve"
            else None
        )
        raw_sleeves.append(row_sleeve or resolve_sleeve_policy())
        draft_rows.append(
            {
                "h": h,
                "price": price,
                "mkt_value": mkt_value,
                "body": body,
                "status": status,
                "verdict": verdict,
                "confidence": confidence,
                "holder_read": holder_read,
                "stance": stance,
                "is_vehicle": is_vehicle,
                "action": action,
            }
        )
    scaled_sleeves = (
        scale_sleeve_policies(raw_sleeves) if sizing_policy == "sleeve" else [None] * len(draft_rows)
    )

    reviews: list[HoldingReview] = []
    concentration: list[ConcentrationFlag] = []
    remaining_cash = settings.cash_balance  # drawn down across BUY_MORE rows (no over-allocation)
    for draft, row_sleeve in zip(draft_rows, scaled_sleeves):
        h = draft["h"]
        price = draft["price"]
        mkt_value = draft["mkt_value"]
        body = draft["body"]
        status = draft["status"]
        verdict = draft["verdict"]
        confidence = draft["confidence"]
        holder_read = draft["holder_read"]
        stance = draft["stance"]
        is_vehicle = draft["is_vehicle"]
        action = draft["action"]

        weight_pct = round(mkt_value / total_value * 100.0, 2) if total_value > 0 else None
        add_target = row_sleeve.low_pct if row_sleeve is not None else target
        trim_target = row_sleeve.high_pct if row_sleeve is not None else target
        row_target = trim_target if trim_target is not None else add_target
        if row_sleeve is not None:
            overweight, _under_floor = weight_vs_sleeve(weight_pct, row_sleeve)
        else:
            overweight = bool(
                row_target is not None and weight_pct is not None and weight_pct > row_target
            )

        avg = h.average_cost
        if price is not None and avg is not None:
            unrealized_pl = round((price - avg) * h.total_quantity, 2)
            unrealized_pl_pct = round((price - avg) / avg * 100.0, 2) if avg > 0 else None
        else:
            unrealized_pl = None
            unrealized_pl_pct = None

        if not advice_enabled:
            rationale = [
                "Informational valuation only — advisory actions are disabled in this mode."
            ]
        else:
            rationale = _rationale_lines(
                action=action, verdict=verdict, stance=stance, status=status,
                overweight=overweight, unrealized_pl_pct=unrealized_pl_pct, target=row_target,
                target_is_default=target_is_default,
                is_fund_vehicle=is_vehicle,
                rs_vs_spy_6m_pct=_rs_vs_spy_6m_from_body(body),
                sleeve=row_sleeve,
            )

        add_amt: float | None = None
        reduce_amt: float | None = None
        if advice_enabled:
            add_gap = suggested_add_amount(mkt_value, total_value, add_target, remaining_cash)
            reduce_excess = suggested_reduce_amount(mkt_value, total_value, trim_target)
            action, add_amt, reduce_amt, sizing_note = apply_stance_sizing(
                action=action,
                overweight=overweight,
                add_gap=add_gap,
                reduce_excess=reduce_excess,
                market_value=mkt_value,
                cash_available=remaining_cash,
            )
            if sizing_note:
                rationale.append(sizing_note)
            if add_amt is not None and add_amt > 0:
                remaining_cash = round(max(0.0, remaining_cash - add_amt), 2)

        row_sizing_reason = sizing_reason(
            action=action,
            target_pct=row_target,
            weight_pct=weight_pct,
            suggested_add=add_amt,
            suggested_reduce=reduce_amt,
            portfolio_value=total_value,
            stance=stance,
            sleeve=row_sleeve,
        )
        row_driver = review_driver_line(
            body,
            action=action,
            is_fund_vehicle=is_vehicle,
        )

        if price is None:
            rationale.append(
                "Live price unavailable — weight and any suggested size use your cost basis, "
                "not a mark; P/L is omitted."
            )

        hint, lt, st = tax_lot_hint(h, action, as_of=as_of)

        if advice_enabled and overweight and weight_pct is not None and row_target is not None:
            phrase = _target_weight_phrase(
                row_target, used_default=target_is_default, sleeve=row_sleeve
            )
            concentration.append(
                ConcentrationFlag(
                    symbol=h.symbol,
                    weight_pct=weight_pct,
                    target_pct=row_target,
                    message=(
                        f"{h.symbol} is {weight_pct:.1f}% of the portfolio, above {phrase} "
                        "— consider trimming to manage single-name risk."
                    ),
                )
            )

        reviews.append(
            HoldingReview(
                symbol=h.symbol,
                quantity=h.total_quantity,
                average_cost=avg,
                current_price=price,
                market_value=mkt_value,
                unrealized_pl=unrealized_pl,
                unrealized_pl_pct=unrealized_pl_pct,
                weight_pct=weight_pct,
                verdict=verdict or "unknown",
                confidence=confidence,
                action=action,
                rationale=rationale,
                overweight=overweight,
                suggested_add_amount=add_amt,
                suggested_reduce_amount=reduce_amt,
                sizing_reason=row_sizing_reason,
                driver_line=row_driver,
                effective_target_pct=row_target,
                sleeve=row_sleeve.label if row_sleeve is not None else None,
                sleeve_low_pct=row_sleeve.low_pct if row_sleeve is not None else None,
                sleeve_high_pct=row_sleeve.high_pct if row_sleeve is not None else None,
                tax_lot_hint=hint,
                long_term_lots=lt,
                short_term_lots=st,
                holder_read=holder_read,
                is_fund_vehicle=is_vehicle,
            )
        )

    # 4) Optional AI narration per holding (endpoint wires the gated fn; skipped offline).
    if ai_read_fn is not None:
        await _attach_ai_reads(reviews, bodies, ai_read_fn)

    # 5) Portfolio-level P/L.
    if fully_priced and total_cost > 0:
        port_pl = round(invested_value - total_cost, 2)
        port_pl_pct = round((invested_value - total_cost) / total_cost * 100.0, 2)
    else:
        port_pl = None
        port_pl_pct = None

    # 6) Benchmark (money-weighted vs SPY / configured symbol). The current benchmark
    #    price reuses the batched snapshot fetched above; only daily bars are fetched here.
    benchmark = await _build_benchmark(
        holdings=holdings, settings=settings, fetch_spy_bars=fetch_spy_bars, as_of=as_of,
        benchmark_current=resolve_current_price(snap_map.get(bench_sym)),
    )

    # 7) "Consider adding" — gem candidates the user does not already hold (advice-gated).
    #    Same sleeve / explicit target as holdings; add toward the floor from $0, cash-capped
    #    after existing BUY_MORE draws so we do not over-allocate cash.
    consider = (
        _consider_adding(
            scan_fn,
            held={h.symbol for h in holdings},
            total_value=total_value,
            cash_available=remaining_cash,
            sizing_policy=sizing_policy,
            explicit_target_pct=target,
        )
        if advice_enabled
        else []
    )

    _LOG.info(
        "portfolio_review built holdings=%d actions=%s concentration=%d consider=%d",
        len(reviews), [r.action.value for r in reviews], len(concentration), len(consider),
    )

    return PortfolioReview(
        generated_at=datetime.now(timezone.utc),
        holdings=reviews,
        total_market_value=total_value,
        invested_value=invested_value,
        cash_balance=settings.cash_balance,
        total_cost=total_cost,
        unrealized_pl=port_pl,
        unrealized_pl_pct=port_pl_pct,
        portfolio_return_pct=port_pl_pct,
        concentration=concentration,
        consider_adding=consider,
        benchmark=benchmark,
        fully_priced=fully_priced,
        effective_target_pct=target,
        target_is_default=target_is_default,
        sizing_policy=sizing_policy,
    )


_DRIVER_MAX = 140


def _rs_vs_spy_6m_from_body(body: dict[str, Any]) -> float | None:
    """6-month RS vs SPY from the Long-Term composite (technical indicator snapshot)."""
    raw = _num(body.get("rs_vs_spy_6m_pct"))
    if raw is not None:
        return raw
    for row in body.get("layers") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("layer") or "").strip().lower() != "technical":
            continue
        snap = row.get("indicator_snapshot")
        snap = snap if isinstance(snap, dict) else {}
        return _num(snap.get("rs_vs_spy_6m_pct"))
    return None


def _clip_driver(text: str, max_chars: int = _DRIVER_MAX) -> str:
    raw = " ".join((text or "").split())
    if len(raw) <= max_chars:
        return raw
    return f"{raw[: max(0, max_chars - 1)].rstrip()}…"


def _first_chip(pillar: dict[str, Any]) -> str:
    for chip in pillar.get("chips") or []:
        text = str(chip or "").strip()
        if text:
            return text
    return ""


def _active_pillars(body: dict[str, Any]) -> list[dict[str, Any]]:
    fund = body.get("position_fundamentals")
    fund = fund if isinstance(fund, dict) else {}
    out: list[dict[str, Any]] = []
    for pillar in fund.get("pillars") or []:
        if not isinstance(pillar, dict):
            continue
        pid = str(pillar.get("pillar_id") or "").strip().upper()
        status = str(pillar.get("status") or "").strip().lower()
        if not pid or status == "unavailable":
            continue
        out.append(pillar)
    return out


def _format_pillar_driver(pillar: dict[str, Any]) -> str:
    pid = str(pillar.get("pillar_id") or "").strip().upper()
    label = str(pillar.get("label") or pid).strip()
    chip = _first_chip(pillar)
    if chip:
        return f"{pid} {label}: {chip}"
    reasoning = str(pillar.get("reasoning") or "").strip()
    if reasoning:
        return reasoning.replace(" Signal data only.", "").strip()
    verdict = str(pillar.get("verdict") or "").strip()
    score = _num(pillar.get("score"))
    if score is not None and verdict:
        return f"{pid} {label} reads {verdict} at {int(round(score))}/100"
    return f"{pid} {label}".strip()


def _pick_pillar(pillars: list[dict[str, Any]], *, prefer_weak: bool) -> dict[str, Any] | None:
    scored = [p for p in pillars if _num(p.get("score")) is not None]
    pool = scored or pillars
    if not pool:
        return None

    def _key(pillar: dict[str, Any]) -> tuple[float, str]:
        score = _num(pillar.get("score"))
        return (score if score is not None else 50.0, str(pillar.get("pillar_id") or ""))

    return min(pool, key=_key) if prefer_weak else max(pool, key=_key)


def review_driver_line(
    body: dict[str, Any] | None,
    *,
    action: ReviewAction,
    is_fund_vehicle: bool = False,
) -> str | None:
    """First-screen Why: the already-computed metric that moved the call.

    No new scores. Vehicles and a broken weekly structure beat pillar chips
    because they *are* the call. Buy-more prefers a bullish F2 chip (growth-led);
    sell/trim/hold cite the weakest scored pillar.
    """
    if is_fund_vehicle:
        return "Fund/ETF vehicle — no corporate F1–F5 (no 10-K)."
    if action == ReviewAction.REVIEW:
        return "The Long-Term desk could not form a confident read."
    if not isinstance(body, dict):
        return None
    if body.get("signal_structure_broken") is True:
        return "Weekly structure is broken — thesis at risk."

    pillars = _active_pillars(body)
    if action == ReviewAction.BUY_MORE:
        f2 = next((p for p in pillars if str(p.get("pillar_id") or "").upper() == "F2"), None)
        if f2 is not None and str(f2.get("verdict") or "").strip().lower() == "bullish":
            return _clip_driver(_format_pillar_driver(f2))
        picked = _pick_pillar(pillars, prefer_weak=False)
    else:
        picked = _pick_pillar(pillars, prefer_weak=True)
    if picked is not None:
        return _clip_driver(_format_pillar_driver(picked))

    verdict = str(body.get("verdict") or body.get("signal_summary") or "").strip()
    if verdict:
        return f"Long-Term composite reads {verdict}."
    return None


def consider_add_driver_line(candidate: Any) -> str | None:
    """First-screen driver for an unheld gem/strong name — F2 chip, else weakest pillar."""
    pillars = [p for p in (getattr(candidate, "pillars", None) or []) if isinstance(p, dict)]
    f2 = next((p for p in pillars if str(p.get("pillar_id") or "").upper() == "F2"), None)
    if f2 is not None:
        chip = _first_chip(f2)
        if chip:
            return _clip_driver(f"F2 Growth: {chip}")
        formatted = _format_pillar_driver(f2)
        if formatted:
            return _clip_driver(formatted)
    weak_id = str(getattr(candidate, "weakest_pillar_id", None) or "").strip().upper()
    weak_label = str(getattr(candidate, "weakest_pillar_label", None) or "").strip()
    if weak_id and weak_label:
        return f"Weakest {weak_id} · {weak_label}"
    if weak_id:
        return f"Weakest {weak_id}"
    return None


def _rationale_lines(
    *,
    action: ReviewAction,
    verdict: str,
    stance: str | None,
    status: str,
    overweight: bool,
    unrealized_pl_pct: float | None,
    target: float | None,
    target_is_default: bool = False,
    is_fund_vehicle: bool = False,
    rs_vs_spy_6m_pct: float | None = None,
    sleeve: SleevePolicy | None = None,
) -> list[str]:
    lines: list[str] = []
    if action == ReviewAction.REVIEW:
        lines.append("The Long-Term desk could not form a confident read (insufficient data).")
        if is_fund_vehicle:
            lines.append(
                "This is a fund/ETF vehicle — corporate F1–F5 pillars do not apply (no 10-K)."
            )
        return lines
    lines.append(f"Long-Term composite reads {verdict or 'neutral'}.")
    if is_fund_vehicle:
        lines.append(
            "This is a fund/ETF vehicle — corporate F1–F5 pillars do not apply (no 10-K)."
        )
    if stance:
        lines.append(f"Holder read: {stance}.")
    if overweight and target is not None:
        phrase = _target_weight_phrase(target, used_default=target_is_default, sleeve=sleeve)
        lines.append(
            f"Position is above {phrase} weight." if sleeve is None and not target_is_default
            else f"Position is above {phrase}."
        )
    if unrealized_pl_pct is not None:
        direction = "up" if unrealized_pl_pct >= 0 else "down"
        lines.append(
            f"You are {direction} {abs(unrealized_pl_pct):.1f}% vs your cost basis "
            f"(lots vs last price — a different window than 6-month RS vs SPY)."
        )
    if rs_vs_spy_6m_pct is not None:
        lines.append(
            f"6-month relative strength vs SPY is {rs_vs_spy_6m_pct:+.1f}% "
            f"(name's 6-month price return minus SPY's — not vs your cost)."
        )
    return lines


def consider_add_sizing(
    *,
    total_value: float,
    cash_available: float,
    verdict: str | None,
    sizing_policy: str | None,
    explicit_target_pct: float | None,
) -> tuple[SleevePolicy | None, float | None, float | None, str | None]:
    """Starter size for an unheld name — same sleeve/explicit target as holdings.

    Market value is $0, so the add is the sleeve floor (or the explicit point
    target), cash-capped. Product mode (no policy) stays directional.
    """
    sleeve: SleevePolicy | None = None
    target: float | None = None
    if sizing_policy == "sleeve":
        sleeve = resolve_sleeve_policy(verdict=verdict)
        target = sleeve.low_pct
    elif sizing_policy == "explicit":
        target = explicit_target_pct
    add = suggested_add_amount(0.0, total_value, target, cash_available)
    reason = _consider_add_sizing_reason(
        sleeve=sleeve, target_pct=target, add=add, total_value=total_value
    )
    return sleeve, target, add, reason


def _consider_add_sizing_reason(
    *,
    sleeve: SleevePolicy | None,
    target_pct: float | None,
    add: float | None,
    total_value: float,
) -> str | None:
    if target_pct is None:
        return None
    book = (target_pct / 100.0) * total_value if total_value > 0 else 0.0
    if sleeve is not None:
        band = f"the {sleeve.label} {sleeve.band_phrase()} sleeve"
        floor = f"the {sleeve.label} ~{sleeve.low_pct:.0f}% floor"
    else:
        band = f"the {_fmt_target_pct(target_pct)} target"
        floor = band
    if add is not None and add > 0:
        if book > 0 and add + 0.005 < book:
            return (
                f"Starter at {band} — add {_fmt_gap_dollars(add)} "
                f"(cash available; full {floor} is {_fmt_gap_dollars(book)})."
            )
        return f"Starter at {band} — add {_fmt_gap_dollars(add)} to reach {floor}."
    if book > 0:
        return f"Starter at {band} is {_fmt_gap_dollars(book)}. No cash left to start it."
    return f"Starter at {band}."


def _consider_adding(
    scan_fn: ScanFn | None,
    *,
    held: set[str],
    total_value: float = 0.0,
    cash_available: float = 0.0,
    sizing_policy: str | None = None,
    explicit_target_pct: float | None = None,
) -> list[ConsiderAddCandidate]:
    """Gem-candidate list, filtered to names not already held (gems + strong tiers)."""
    try:
        candidates = list(scan_fn()) if scan_fn is not None else _default_scan()
    except Exception as exc:  # noqa: BLE001 — discovery is best-effort, never fail the review
        _LOG.warning("portfolio_review consider_adding failed: %s", exc)
        return []
    out: list[ConsiderAddCandidate] = []
    remaining = cash_available
    for c in candidates:
        sym = str(getattr(c, "symbol", "") or "").strip().upper()
        tier = str(getattr(c, "tier", "") or "").strip().lower()
        if not sym or sym in held:
            continue
        if tier not in ("gem", "strong"):
            continue
        verdict = str(getattr(c, "verdict", "") or "neutral")
        sleeve, target, add, reason = consider_add_sizing(
            total_value=total_value,
            cash_available=remaining,
            verdict=verdict,
            sizing_policy=sizing_policy,
            explicit_target_pct=explicit_target_pct,
        )
        if add is not None and add > 0:
            remaining = round(max(0.0, remaining - add), 2)
        out.append(
            ConsiderAddCandidate(
                symbol=sym,
                tier=tier,
                verdict=verdict,
                why=str(getattr(c, "why", "") or ""),
                sleeve=sleeve.label if sleeve is not None else None,
                sleeve_low_pct=sleeve.low_pct if sleeve is not None else None,
                sleeve_high_pct=sleeve.high_pct if sleeve is not None else None,
                target_pct=target,
                suggested_add_amount=add,
                sizing_reason=reason,
                driver_line=consider_add_driver_line(c),
            )
        )
    return out[:5]


async def _build_benchmark(
    *,
    holdings: list[PortfolioHolding],
    settings: PortfolioSettings,
    fetch_spy_bars: SpyBarsFn,
    as_of: date,
    benchmark_current: float | None,
) -> BenchmarkComparison | None:
    lots: list[tuple[float, str]] = [
        (lot.total_cost, lot.purchase_date) for h in holdings for lot in h.lots
    ]
    if not lots:
        return None
    bench_sym = settings.benchmark_symbol
    earliest_iso = min(purchase for _, purchase in lots)
    try:
        earliest = date.fromisoformat(earliest_iso[:10])
    except (ValueError, TypeError):
        earliest = as_of
    try:
        bars = await fetch_spy_bars(bench_sym, earliest)
    except Exception as exc:  # noqa: BLE001 — benchmark is best-effort
        _LOG.warning("portfolio_review benchmark fetch failed: %s", exc)
        return None
    return compute_benchmark_comparison(
        lots=lots,
        spy_close_on=_build_spy_close_lookup(bars or []),
        spy_current=benchmark_current,
        benchmark_symbol=bench_sym,
    )


async def _attach_ai_reads(
    reviews: list[HoldingReview],
    bodies: list[Any],
    ai_read_fn: AiReadFn,
) -> None:
    async def _one(idx: int, body: Any) -> tuple[int, str | None]:
        if not isinstance(body, dict):
            return idx, None
        payload = dict(body)
        payload["review_action"] = reviews[idx].action.value
        payload["holder_stance"] = str(
            (reviews[idx].holder_read or {}).get("stance") or ""
        ).strip().lower() or None
        payload["suggested_add_amount"] = reviews[idx].suggested_add_amount
        payload["suggested_reduce_amount"] = reviews[idx].suggested_reduce_amount
        try:
            return idx, await ai_read_fn(reviews[idx].symbol, payload)
        except Exception as exc:  # noqa: BLE001 — AI narration never fails the review
            _LOG.warning("portfolio_review ai_read failed symbol=%s err=%s", reviews[idx].symbol, exc)
            return idx, None

    results = await asyncio.gather(*[_one(i, b) for i, b in enumerate(bodies)])
    for idx, text in results:
        if text:
            # dataclass is frozen — rebuild the row with the ai_read attached.
            reviews[idx] = _with_ai_read(reviews[idx], text)


def _with_ai_read(row: HoldingReview, text: str) -> HoldingReview:
    from dataclasses import replace

    return replace(row, ai_read=text)


async def _compose_all(
    compose: ComposeFn, symbols: list[str], *, concurrency: int
) -> list[Any]:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(sym: str) -> Any:
        async with sem:
            try:
                return await compose(sym)
            except Exception as exc:  # noqa: BLE001 — one bad symbol must not fail the review
                _LOG.warning("portfolio_review compose failed symbol=%s err=%s", sym, exc)
                return {}

    return list(await asyncio.gather(*[_one(s) for s in symbols]))


async def _safe_snapshots(fetch_snapshots: SnapshotFn, symbols: list[str]) -> dict[str, Any]:
    try:
        result = await fetch_snapshots(symbols)
        return result if isinstance(result, dict) else {}
    except Exception as exc:  # noqa: BLE001 — pricing degrades to cost-basis fallback
        _LOG.warning("portfolio_review snapshot fetch failed: %s", exc)
        return {}


# ──────────────────────────────────────────────────────────────────────────────
# Default (production) data providers — thin wrappers over the existing engine.
# ──────────────────────────────────────────────────────────────────────────────

async def _default_compose(symbol: str) -> dict[str, Any]:
    from stocvest.api.services.position_composite_engine import build_position_composite_response
    from stocvest.config.parameter_store import ParameterStore

    params = ParameterStore.get_parameters_sync()
    return await build_position_composite_response(
        symbol=symbol, user_id=None, user_email=None, params=params
    )


async def _default_snapshots(symbols: list[str]) -> dict[str, Any]:
    from stocvest.data.polygon_client import PolygonClient
    from stocvest.utils.config import get_settings

    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        return await client.get_snapshots(symbols)


async def _default_spy_bars(symbol: str, from_date: date) -> list[Any]:
    from stocvest.data.models import Timeframe
    from stocvest.data.polygon_client import PolygonClient
    from stocvest.utils.config import get_settings

    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        return await client.get_bars(
            symbol, Timeframe.DAY_1, from_date=from_date, limit=2000
        )


def _default_scan() -> list[Any]:
    from stocvest.api.services.position_scan import get_position_scan_snapshot_sync

    snapshot, _cached = get_position_scan_snapshot_sync()
    if snapshot is None:
        return []
    return list(snapshot.candidates)


def build_portfolio_review_sync(
    *,
    holdings: tuple[PortfolioHolding, ...] | list[PortfolioHolding],
    settings: PortfolioSettings,
    user_id: str | None = None,
    user_email: str | None = None,
    snapshot_fn: SnapshotFn | None = None,
    spy_bars_fn: SpyBarsFn | None = None,
    scan_fn: ScanFn | None = None,
    advice_enabled: bool | None = None,
) -> PortfolioReview:
    """Blocking wrapper for the Lambda handler (own asyncio loop).

    Optional provider fns let callers (e.g. the daily digest job) share cached
    data — a single benchmark-bars fetch, one position-scan snapshot — across many
    users in one run instead of re-fetching per user.
    """
    return asyncio.run(
        build_portfolio_review(
            holdings=holdings,
            settings=settings,
            user_id=user_id,
            user_email=user_email,
            snapshot_fn=snapshot_fn,
            spy_bars_fn=spy_bars_fn,
            scan_fn=scan_fn,
            advice_enabled=advice_enabled,
        )
    )

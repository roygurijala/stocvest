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

No indicator math or thresholds are invented here (see .cursorrules §8):
- verdict + stance come straight from the composite engine,
- the "overweight" test uses the *user's own* ``target_position_pct``,
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

from stocvest.models.portfolio_holding import PortfolioHolding, PortfolioSettings
from stocvest.signals.position_holder_read import build_position_holder_read
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_REVIEW_DISCLAIMER = (
    "Informational review of a personal, manually-entered portfolio — not personalized "
    "investment advice. Signal data only; you are responsible for your own decisions."
)

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


def suggested_add_amount(
    market_value: float,
    total_value: float,
    target_pct: float | None,
    cash_available: float,
) -> float | None:
    """Dollar amount to lift a position toward its target weight, capped by cash.

    ``None`` when no target is set (guidance stays directional, no amount). ``0.0``
    when the position is already at/over its target weight or there is no cash. Uses
    the user's own ``target_pct`` — no invented sizing threshold.
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
    directional — "reduce exposure" — without inventing a trim size).
    """
    if target_pct is None or total_value <= 0:
        return None
    target_value = (target_pct / 100.0) * total_value
    excess = market_value - target_value
    if excess <= 0:
        return None
    return round(excess, 2)


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
        f"Money-weighted: the same dollars invested in {benchmark_symbol} on each "
        "purchase date."
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

    def to_api(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "tier": self.tier,
            "verdict": self.verdict,
            "why": self.why,
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

    if not holdings:
        return PortfolioReview(
            generated_at=datetime.now(timezone.utc),
            cash_balance=settings.cash_balance,
            total_market_value=settings.cash_balance,
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

    # 3) Per-holding review rows.
    reviews: list[HoldingReview] = []
    concentration: list[ConcentrationFlag] = []
    remaining_cash = settings.cash_balance  # drawn down across BUY_MORE rows (no over-allocation)
    for (h, price, mkt_value), body in zip(priced, bodies):
        body = body if isinstance(body, dict) else {}
        status = str(body.get("status") or "").strip().lower()
        verdict = str(body.get("signal_summary") or body.get("verdict") or "").strip().lower()
        confidence = _num(body.get("signal_strength"))
        # Holder-read is owner-oriented management guidance (ship-dark elsewhere) — only
        # surface it when advice is enabled, matching the deep-dive's gating.
        holder_read = build_position_holder_read(body) if (body and advice_enabled) else None
        stance = str((holder_read or {}).get("stance") or "").strip().lower() or None

        # Signal-first action — suppressed to an informational REVIEW when advice is off.
        action = (
            derive_action(verdict=verdict, holder_stance=stance, status=status)
            if advice_enabled
            else ReviewAction.REVIEW
        )

        weight_pct = round(mkt_value / total_value * 100.0, 2) if total_value > 0 else None
        target = settings.target_position_pct
        overweight = bool(target is not None and weight_pct is not None and weight_pct > target)

        # P/L (null, never fake $0, when unpriced).
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
                overweight=overweight, unrealized_pl_pct=unrealized_pl_pct, target=target,
                is_fund_vehicle=body.get("is_fund_vehicle") is True,
            )

        add_amt: float | None = None
        reduce_amt: float | None = None
        if action == ReviewAction.BUY_MORE:
            # Cap by cash still un-suggested to earlier BUY_MORE rows (no aggregate over-allocation).
            add_amt = suggested_add_amount(mkt_value, total_value, target, remaining_cash)
            # Sizing gate: at/over target or no cash → the "buy more" downgrades to hold.
            if add_amt == 0.0:
                action = ReviewAction.HOLD
                rationale.append(
                    "Already at/over target weight (or no cash available) — holding rather than adding."
                )
            elif add_amt is not None:
                remaining_cash = round(max(0.0, remaining_cash - add_amt), 2)
        elif action in (ReviewAction.TRIM, ReviewAction.SELL):
            reduce_amt = suggested_reduce_amount(mkt_value, total_value, target)

        hint, lt, st = tax_lot_hint(h, action, as_of=as_of)

        if advice_enabled and overweight and weight_pct is not None:
            concentration.append(
                ConcentrationFlag(
                    symbol=h.symbol,
                    weight_pct=weight_pct,
                    target_pct=target,
                    message=(
                        f"{h.symbol} is {weight_pct:.1f}% of the portfolio, above your "
                        f"{target:.1f}% target — consider trimming to manage single-name risk."
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
                tax_lot_hint=hint,
                long_term_lots=lt,
                short_term_lots=st,
                holder_read=holder_read,
                is_fund_vehicle=body.get("is_fund_vehicle") is True,
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
    consider = (
        _consider_adding(scan_fn, held={h.symbol for h in holdings}) if advice_enabled else []
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
    )


def _rationale_lines(
    *,
    action: ReviewAction,
    verdict: str,
    stance: str | None,
    status: str,
    overweight: bool,
    unrealized_pl_pct: float | None,
    target: float | None,
    is_fund_vehicle: bool = False,
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
        lines.append(f"Position is above your {target:.1f}% target weight.")
    if unrealized_pl_pct is not None:
        direction = "up" if unrealized_pl_pct >= 0 else "down"
        lines.append(f"You are {direction} {abs(unrealized_pl_pct):.1f}% vs your cost basis.")
    return lines


def _consider_adding(scan_fn: ScanFn | None, *, held: set[str]) -> list[ConsiderAddCandidate]:
    """Gem-candidate list, filtered to names not already held (gems + strong tiers)."""
    try:
        candidates = list(scan_fn()) if scan_fn is not None else _default_scan()
    except Exception as exc:  # noqa: BLE001 — discovery is best-effort, never fail the review
        _LOG.warning("portfolio_review consider_adding failed: %s", exc)
        return []
    out: list[ConsiderAddCandidate] = []
    for c in candidates:
        sym = str(getattr(c, "symbol", "") or "").strip().upper()
        tier = str(getattr(c, "tier", "") or "").strip().lower()
        if not sym or sym in held:
            continue
        if tier not in ("gem", "strong"):
            continue
        out.append(
            ConsiderAddCandidate(
                symbol=sym,
                tier=tier,
                verdict=str(getattr(c, "verdict", "") or "neutral"),
                why=str(getattr(c, "why", "") or ""),
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

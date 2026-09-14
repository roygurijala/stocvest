"""Position universe scan (POS-D15) — ranked gem candidates.

Live refresh composites a mid-cap discovery slice plus the curated mega-cap
board, scores through gem gates, ranks by ``gem_rank``, and caches a
:class:`PositionScanSnapshot`. This backs ``GET /v1/signals/position/candidates``
and ``/dashboard/invest``.

Gem is growth-led discovery (hygiene + F2 + sector tailwind). News/geo are a
catalyst, not the badge. The hunt pond is persisted separately and re-scored
on live refresh; weekly batch rebuilds it. The curated mega list is for
Strong/Monitor, with a rare mega-cap gem exception. Everything here is
dependency-injectable so the gate/rank/sort logic is unit-testable without network.
"""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.services.position_composite_engine import build_position_composite_response
from stocvest.config.parameter_store import ParameterStore
from stocvest.signals.position_gem_gates import (
    CandidateFeatures,
    TIER_GEM,
    TIER_INSUFFICIENT,
    build_gem_why,
    compute_gem_rank,
    evaluate_gem_gates,
    extract_candidate_features,
    failing_gates,
    has_catalyst,
    has_sector_tailwind,
    is_growth_led,
    resolve_gem_action,
    resolve_gem_tier,
    tier_sort_key,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Gate/rank contract id stored *inside* the snapshot blob. Bump this when
# resolve_gem_tier / gem_rank change. Never encode it in the Dynamo key —
# a new key orphans the last successful list and leaves Invest pending.
POSITION_SCAN_ENGINE_VERSION = "growth_led_2"
# Hunt-pond TTL. Live refresh re-scores the same symbols until this elapses
# (or the weekly batch rebuilds). Not a Dynamo TTL — freshness is checked in code.
UNIVERSE_STALE_SECONDS = 7 * 24 * 3600

# Curated mega / already-found board — Strong/Monitor home, not the gem hunt.
# Discovery names come from ``build_live_scan_universe`` / weekly batch.
POSITION_SCAN_UNIVERSE_V1: tuple[str, ...] = (
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "AVGO", "JPM", "V", "MA",
    "UNH", "JNJ", "PG", "HD", "COST", "KO", "PEP", "XOM", "CVX", "LLY",
    "ABBV", "MRK", "WMT", "CAT", "HON",
)

_SCAN_TTL_SECONDS = 6 * 3600
_ComposeFn = Callable[[str], Awaitable[dict[str, Any]]]

# Module-level snapshot cache (in-process; weekly batch persists to Dynamo/S3 later).
# A threading.Lock (not asyncio.Lock) guards it: the sync entry point runs each
# scan in its own asyncio.run loop, and an asyncio.Lock would bind to the first
# loop and raise "bound to a different event loop" on the next warm invocation.
_snapshot_cache: tuple[float, "PositionScanSnapshot"] | None = None
_cache_lock = threading.Lock()


def reset_position_scan_cache_for_tests() -> None:
    clear_position_scan_snapshot_cache()


def clear_position_scan_snapshot_cache() -> None:
    """Drop the in-process snapshot so the next read hits the store (or pending)."""
    global _snapshot_cache
    with _cache_lock:
        _snapshot_cache = None


def set_position_scan_snapshot_cache(snapshot: "PositionScanSnapshot", *, ttl_seconds: int = _SCAN_TTL_SECONDS) -> None:
    """Warm the in-process cache with a snapshot (used by the weekly batch worker)."""
    global _snapshot_cache
    with _cache_lock:
        _snapshot_cache = (time.time() + max(0, ttl_seconds), snapshot)


@dataclass(frozen=True)
class GemCandidate:
    symbol: str
    tier: str
    rank: float
    composite_score: int | None
    verdict: str
    fundamentals_score: int | None
    fundamentals_verdict: str
    technical_score: int | None
    technical_verdict: str
    sector_verdict: str
    data_quality: str
    weakest_pillar_id: str | None
    weakest_pillar_label: str | None
    rs_vs_spy_6m_pct: float | None
    signal_valid_days: int | None
    why: str
    pillars: list[dict[str, Any]]
    failing_gates: list[str]
    growth_led: bool = False
    sector_tailwind: bool = False
    catalyst: bool = False

    def to_api_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "symbol": self.symbol,
            "tier": self.tier,
            "rank": self.rank,
            "composite_score": self.composite_score,
            "verdict": self.verdict,
            "fundamentals_score": self.fundamentals_score,
            "fundamentals_verdict": self.fundamentals_verdict,
            "technical_score": self.technical_score,
            "technical_verdict": self.technical_verdict,
            "sector_verdict": self.sector_verdict,
            "data_quality": self.data_quality,
            "weakest_pillar_id": self.weakest_pillar_id,
            "weakest_pillar_label": self.weakest_pillar_label,
            "rs_vs_spy_6m_pct": self.rs_vs_spy_6m_pct,
            "signal_valid_days": self.signal_valid_days,
            "why": self.why,
            "pillars": list(self.pillars),
            "failing_gates": list(self.failing_gates),
            "growth_led": self.growth_led,
            "sector_tailwind": self.sector_tailwind,
            "catalyst": self.catalyst,
        }
        # PERSONAL-MODE: attach an explicit Buy / Watch / Don't-buy action derived
        # deterministically from the tier. Omitted entirely in product mode so the API
        # response is byte-identical to the stricter POS-D12 contract when the flag is off.
        if get_settings().stocvest_personal_advice_mode_enabled:
            action_key, action_label = resolve_gem_action(self.tier)
            body["action"] = action_key
            body["action_label"] = action_label
        return body

    @classmethod
    def from_store_dict(cls, d: dict[str, Any]) -> "GemCandidate":
        """Rehydrate from a persisted ``to_api_dict`` blob (POS-D15 snapshot store)."""
        return cls(
            symbol=str(d.get("symbol") or "").strip().upper(),
            tier=str(d.get("tier") or TIER_INSUFFICIENT),
            rank=float(d.get("rank") or 0.0),
            composite_score=d.get("composite_score"),
            verdict=str(d.get("verdict") or "neutral"),
            fundamentals_score=d.get("fundamentals_score"),
            fundamentals_verdict=str(d.get("fundamentals_verdict") or "neutral"),
            technical_score=d.get("technical_score"),
            technical_verdict=str(d.get("technical_verdict") or "neutral"),
            sector_verdict=str(d.get("sector_verdict") or "neutral"),
            data_quality=str(d.get("data_quality") or "unknown"),
            weakest_pillar_id=d.get("weakest_pillar_id"),
            weakest_pillar_label=d.get("weakest_pillar_label"),
            rs_vs_spy_6m_pct=d.get("rs_vs_spy_6m_pct"),
            signal_valid_days=d.get("signal_valid_days"),
            why=str(d.get("why") or ""),
            pillars=list(d.get("pillars") or []),
            failing_gates=list(d.get("failing_gates") or []),
            growth_led=bool(d.get("growth_led")),
            sector_tailwind=bool(d.get("sector_tailwind")),
            catalyst=bool(d.get("catalyst")),
        )


@dataclass(frozen=True)
class GemListChange:
    symbol: str
    change: str  # entered | exited
    reason: str

    def to_api_dict(self) -> dict[str, Any]:
        return {"symbol": self.symbol, "change": self.change, "reason": self.reason}

    @classmethod
    def from_store_dict(cls, d: dict[str, Any]) -> "GemListChange | None":
        symbol = str(d.get("symbol") or "").strip().upper()
        change = str(d.get("change") or "").strip().lower()
        if not symbol or change not in ("entered", "exited"):
            return None
        return cls(symbol=symbol, change=change, reason=str(d.get("reason") or "").strip())


@dataclass(frozen=True)
class PositionScanUniverse:
    """Persisted hunt pond — symbols only. Scores live on the snapshot item."""

    symbols: list[str]
    generated_at: datetime
    source: str = "live"

    def is_stale(self, *, now: datetime | None = None, max_age_seconds: int = UNIVERSE_STALE_SECONDS) -> bool:
        ref = now or datetime.now(timezone.utc)
        gen = self.generated_at
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        return (ref - gen).total_seconds() >= max_age_seconds

    def to_store_dict(self) -> dict[str, Any]:
        return {
            "symbols": list(self.symbols),
            "generated_at": self.generated_at.replace(microsecond=0).isoformat(),
            "source": self.source,
        }

    @classmethod
    def from_store_dict(cls, d: dict[str, Any]) -> "PositionScanUniverse | None":
        raw_syms = d.get("symbols") or []
        if not isinstance(raw_syms, list):
            return None
        symbols: list[str] = []
        seen: set[str] = set()
        for raw in raw_syms:
            sym = str(raw or "").strip().upper()
            if not sym or sym in seen:
                continue
            seen.add(sym)
            symbols.append(sym)
        if not symbols:
            return None
        raw_at = d.get("generated_at")
        if not raw_at:
            return None
        try:
            gen = datetime.fromisoformat(str(raw_at).replace("Z", "+00:00"))
        except ValueError:
            return None
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        source = str(d.get("source") or "live").strip().lower() or "live"
        return cls(symbols=symbols, generated_at=gen, source=source)


@dataclass(frozen=True)
class PositionScanSnapshot:
    generated_at: datetime
    universe_size: int
    candidates: list[GemCandidate] = field(default_factory=list)
    engine_version: str = POSITION_SCAN_ENGINE_VERSION
    list_delta: list[GemListChange] = field(default_factory=list)
    universe_generated_at: datetime | None = None

    def filtered(self, *, tier: str, limit: int) -> list[GemCandidate]:
        t = (tier or "gem").strip().lower()
        if t in ("", "all", "any"):
            rows = [c for c in self.candidates if c.tier != TIER_INSUFFICIENT]
        else:
            rows = [c for c in self.candidates if c.tier == t]
        return rows[: max(0, limit)]

    def to_api_dict(self, *, tier: str = "gem", limit: int = 50, cached: bool = False) -> dict[str, Any]:
        rows = self.filtered(tier=tier, limit=limit)
        return {
            "mode": "position",
            "tier": (tier or "gem").strip().lower(),
            "candidates": [c.to_api_dict() for c in rows],
            "count": len(rows),
            "universe_size": self.universe_size,
            "scan_generated_at": self.generated_at.replace(microsecond=0).isoformat(),
            "cached": cached,
            "engine_version": self.engine_version,
            "list_delta": [c.to_api_dict() for c in self.list_delta],
            "universe_generated_at": (
                self.universe_generated_at.replace(microsecond=0).isoformat()
                if self.universe_generated_at is not None
                else None
            ),
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }

    def to_store_dict(self) -> dict[str, Any]:
        """Full snapshot blob for cross-instance persistence (POS-D15 weekly batch)."""
        return {
            "generated_at": self.generated_at.replace(microsecond=0).isoformat(),
            "universe_size": self.universe_size,
            "engine_version": self.engine_version,
            "candidates": [c.to_api_dict() for c in self.candidates],
            "list_delta": [c.to_api_dict() for c in self.list_delta],
            "universe_generated_at": (
                self.universe_generated_at.replace(microsecond=0).isoformat()
                if self.universe_generated_at is not None
                else None
            ),
        }

    @classmethod
    def from_store_dict(cls, d: dict[str, Any]) -> "PositionScanSnapshot":
        raw = d.get("generated_at")
        try:
            gen = datetime.fromisoformat(str(raw).replace("Z", "+00:00")) if raw else datetime.now(timezone.utc)
        except ValueError:
            gen = datetime.now(timezone.utc)
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        cands: list[GemCandidate] = []
        for row in d.get("candidates") or []:
            if isinstance(row, dict):
                try:
                    cands.append(GemCandidate.from_store_dict(row))
                except Exception:  # noqa: BLE001 — skip a malformed row, keep the rest
                    continue
        delta: list[GemListChange] = []
        for row in d.get("list_delta") or []:
            if isinstance(row, dict):
                change = GemListChange.from_store_dict(row)
                if change is not None:
                    delta.append(change)
        univ_at: datetime | None = None
        raw_univ = d.get("universe_generated_at")
        if raw_univ:
            try:
                univ_at = datetime.fromisoformat(str(raw_univ).replace("Z", "+00:00"))
            except ValueError:
                univ_at = None
            if univ_at is not None and univ_at.tzinfo is None:
                univ_at = univ_at.replace(tzinfo=timezone.utc)
        return cls(
            generated_at=gen,
            universe_size=int(d.get("universe_size") or len(cands)),
            candidates=cands,
            engine_version=str(d.get("engine_version") or "").strip(),
            list_delta=delta,
            universe_generated_at=univ_at,
        )


def _bottom_quartile_threshold(values: list[float]) -> float | None:
    """25th-percentile threshold; None when too few points to be meaningful."""
    pts = sorted(v for v in values if v is not None)
    if len(pts) < 4:
        return None
    # Linear interpolation at p=0.25 over sorted points.
    pos = 0.25 * (len(pts) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(pts) - 1)
    frac = pos - lo
    return pts[lo] + (pts[hi] - pts[lo]) * frac


def _pillar_rows(features: CandidateFeatures) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pid in ("F1", "F2", "F3", "F4", "F5"):
        pf = features.pillars.get(pid)
        if pf is None:
            continue
        out.append(
            {
                "pillar_id": pf.pillar_id,
                "label": pf.label,
                "score": pf.score,
                "verdict": pf.verdict,
                "data_quality": pf.data_quality,
            }
        )
    return out


def build_candidate(features: CandidateFeatures, *, rs_bottom_quartile_threshold: float | None) -> GemCandidate:
    gates = evaluate_gem_gates(features, rs_bottom_quartile_threshold=rs_bottom_quartile_threshold)
    tier = resolve_gem_tier(features, gates)
    rank = compute_gem_rank(features)
    why = build_gem_why(features, gates, tier)
    weak = features.pillars.get(features.weakest_pillar_id) if features.weakest_pillar_id else None
    return GemCandidate(
        symbol=features.symbol,
        tier=tier,
        rank=rank,
        composite_score=features.composite_score,
        verdict=features.verdict,
        fundamentals_score=features.fundamentals_score,
        fundamentals_verdict=features.fundamentals_verdict,
        technical_score=features.technical_score,
        technical_verdict=features.technical_verdict,
        sector_verdict=features.sector_verdict,
        data_quality=features.fundamentals_data_quality,
        weakest_pillar_id=features.weakest_pillar_id,
        weakest_pillar_label=(weak.label if weak is not None else None),
        rs_vs_spy_6m_pct=features.rs_vs_spy_6m_pct,
        signal_valid_days=features.signal_valid_days,
        why=why,
        pillars=_pillar_rows(features),
        failing_gates=failing_gates(gates),
        growth_led=is_growth_led(features),
        sector_tailwind=has_sector_tailwind(features),
        catalyst=has_catalyst(features),
    )


def rank_candidates(bodies: list[dict[str, Any]]) -> list[GemCandidate]:
    """Pure ranking: composite bodies -> tier/rank-sorted gem candidates."""
    features = [extract_candidate_features(b) for b in bodies if isinstance(b, dict)]
    rs_values = [f.rs_vs_spy_6m_pct for f in features if f.rs_vs_spy_6m_pct is not None]
    threshold = _bottom_quartile_threshold(rs_values)
    candidates = [build_candidate(f, rs_bottom_quartile_threshold=threshold) for f in features]
    candidates.sort(key=lambda c: (tier_sort_key(c.tier), -c.rank, c.symbol))
    return candidates


async def _default_compose(symbol: str) -> dict[str, Any]:
    params = ParameterStore.get_parameters_sync()
    return await build_position_composite_response(
        symbol=symbol,
        user_id=None,
        user_email=None,
        params=params,
        scan_lite=True,
    )


async def run_position_scan_async(
    *,
    universe: tuple[str, ...] | list[str] | None = None,
    compose: _ComposeFn | None = None,
    concurrency: int = 6,
) -> PositionScanSnapshot:
    symbols = list(universe) if universe is not None else list(POSITION_SCAN_UNIVERSE_V1)
    composer = compose or _default_compose
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(sym: str) -> dict[str, Any] | None:
        async with sem:
            try:
                return await composer(sym)
            except Exception as exc:  # scan must not fail on one bad symbol
                _LOG.warning("position_scan compose failed symbol=%s err=%s", sym, exc)
                return None

    results = await asyncio.gather(*[_one(s) for s in symbols])
    bodies = [b for b in results if isinstance(b, dict)]
    candidates = rank_candidates(bodies)
    return PositionScanSnapshot(
        generated_at=datetime.now(timezone.utc),
        universe_size=len(symbols),
        candidates=candidates,
    )


def run_position_scan(
    *,
    universe: tuple[str, ...] | list[str] | None = None,
    compose: _ComposeFn | None = None,
) -> PositionScanSnapshot:
    return asyncio.run(run_position_scan_async(universe=universe, compose=compose))


def merge_scan_snapshots(
    first: PositionScanSnapshot,
    second: PositionScanSnapshot,
    *,
    universe_size: int,
) -> PositionScanSnapshot:
    """Union candidates by symbol (second wins), then re-sort by gem rank."""
    by_symbol = {c.symbol: c for c in first.candidates}
    for candidate in second.candidates:
        by_symbol[candidate.symbol] = candidate
    merged = list(by_symbol.values())
    merged.sort(key=lambda c: (tier_sort_key(c.tier), -c.rank, c.symbol))
    return PositionScanSnapshot(
        generated_at=second.generated_at,
        universe_size=universe_size,
        candidates=merged,
        engine_version=POSITION_SCAN_ENGINE_VERSION,
        list_delta=list(second.list_delta or first.list_delta),
        universe_generated_at=second.universe_generated_at or first.universe_generated_at,
    )


def gem_exit_reason(candidate: GemCandidate | None, *, in_pond: bool) -> str:
    """Why a prior gem left the badge — derived from stored fields, no new floors."""
    if not in_pond:
        return "left the hunt pond"
    if candidate is None:
        return "failed to score"
    if not candidate.growth_led:
        return "F2 no longer bullish"
    if not candidate.sector_tailwind:
        return "sector tailwind faded"
    if any(g in candidate.failing_gates for g in ("G8", "G9", "G3")):
        return "hygiene failed"
    if "G5" in candidate.failing_gates:
        return "hygiene failed"
    return "no longer meets gem gates"


def diff_gem_sets(
    previous: list[GemCandidate],
    current: list[GemCandidate],
    *,
    current_universe: set[str],
) -> list[GemListChange]:
    """Entered/exited gems vs the last snapshot. Empty previous → no delta (first scan)."""
    if not previous:
        return []
    prev_gems = {c.symbol: c for c in previous if c.tier == TIER_GEM}
    curr_gems = {c.symbol: c for c in current if c.tier == TIER_GEM}
    prev_symbols = {c.symbol for c in previous}
    curr_by_symbol = {c.symbol: c for c in current}
    changes: list[GemListChange] = []
    for sym in curr_gems:
        if sym in prev_gems:
            continue
        reason = "now hygiene + F2 + sector" if sym in prev_symbols else "added to hunt pond"
        changes.append(GemListChange(symbol=sym, change="entered", reason=reason))
    for sym in prev_gems:
        if sym in curr_gems:
            continue
        row = curr_by_symbol.get(sym)
        reason = gem_exit_reason(row, in_pond=sym in current_universe)
        changes.append(GemListChange(symbol=sym, change="exited", reason=reason))
    changes.sort(key=lambda c: (0 if c.change == "entered" else 1, c.symbol))
    return changes


def attach_list_delta(
    previous: PositionScanSnapshot | None,
    current: PositionScanSnapshot,
    *,
    universe: list[str],
    universe_generated_at: datetime | None,
) -> PositionScanSnapshot:
    delta = diff_gem_sets(
        previous.candidates if previous is not None else [],
        current.candidates,
        current_universe=set(universe),
    )
    return PositionScanSnapshot(
        generated_at=current.generated_at,
        universe_size=len(universe) if universe else current.universe_size,
        candidates=current.candidates,
        engine_version=POSITION_SCAN_ENGINE_VERSION,
        list_delta=delta,
        universe_generated_at=universe_generated_at,
    )


def _split_pond(symbols: list[str]) -> tuple[list[str], list[str]]:
    """Curated board first (progressive persist), then discovery extras."""
    curated_set = set(POSITION_SCAN_UNIVERSE_V1)
    in_pond = {str(s).strip().upper() for s in symbols if str(s).strip()}
    curated = [s for s in POSITION_SCAN_UNIVERSE_V1 if s in in_pond]
    extra = [str(s).strip().upper() for s in symbols if str(s).strip().upper() not in curated_set]
    return curated, extra


def _live_pond_max() -> int:
    """Signals-Lambda compose budget: curated board + live discovery cap."""
    from stocvest.api.services.position_universe import LIVE_DISCOVERY_MAX

    return len(POSITION_SCAN_UNIVERSE_V1) + int(LIVE_DISCOVERY_MAX)


def _pond_fits_live_budget(symbols: list[str]) -> bool:
    return len(symbols) <= _live_pond_max()


def _load_previous_snapshot() -> PositionScanSnapshot | None:
    cached = _snapshot_cache
    if cached is not None:
        return cached[1]
    try:
        from stocvest.api.services.position_scan_store import get_position_scan_store

        return get_position_scan_store().get()
    except Exception:  # noqa: BLE001 — previous list is best-effort for delta
        return None


def _safe_get_universe() -> PositionScanUniverse | None:
    try:
        from stocvest.api.services.position_scan_store import get_position_scan_store

        return get_position_scan_store().get_universe()
    except Exception:  # noqa: BLE001
        return None


def _safe_put_universe(universe: PositionScanUniverse) -> None:
    try:
        from stocvest.api.services.position_scan_store import get_position_scan_store

        get_position_scan_store().put_universe(universe)
    except Exception:  # noqa: BLE001 — pond persist must never fail the worker
        _LOG.warning("position scan universe persist failed")


async def _run_live_position_scan() -> PositionScanSnapshot:
    """Re-score the persisted pond, or sample a new one when missing/stale.

    First run still persists the curated board immediately so GET has names
    while discovery extras finish. A later refresh re-scores the same symbols
    and does not resample FMP mid-caps.
    """
    previous = _load_previous_snapshot()
    stored_univ = _safe_get_universe()
    curated = list(POSITION_SCAN_UNIVERSE_V1)
    extra: list[str] = []
    univ_at: datetime | None = None

    if stored_univ is not None and stored_univ.symbols and not stored_univ.is_stale():
        curated, extra = _split_pond(stored_univ.symbols)
        if not curated:
            curated = list(POSITION_SCAN_UNIVERSE_V1)
        extra_held: list[str] = []
        # Weekly batch writes ~200 mid-caps onto the same key. Re-scoring that
        # pond on the 180s signals Lambda recreates the timeout. Re-score the
        # live budget; keep last-batch scores for the names we do not touch.
        if not _pond_fits_live_budget(stored_univ.symbols):
            from stocvest.api.services.position_universe import LIVE_DISCOVERY_MAX

            extra_held = extra[int(LIVE_DISCOVERY_MAX) :]
            extra = extra[: int(LIVE_DISCOVERY_MAX)]
            _LOG.info(
                "live scan capped oversized pond size=%s live_extra=%s held=%s source=%s",
                len(stored_univ.symbols),
                len(extra),
                len(extra_held),
                stored_univ.source,
            )
        univ_at = stored_univ.generated_at
        snapshot = await run_position_scan_async(universe=curated)
        if previous is None:
            set_position_scan_snapshot_cache(snapshot)
            _persist_position_scan_snapshot(snapshot)
        if extra:
            more = await run_position_scan_async(universe=extra)
            snapshot = merge_scan_snapshots(snapshot, more, universe_size=len(curated) + len(extra))
        if previous is not None and extra_held:
            held_set = set(extra_held)
            held = [c for c in previous.candidates if c.symbol in held_set]
            if held:
                snapshot = merge_scan_snapshots(
                    PositionScanSnapshot(
                        generated_at=previous.generated_at,
                        universe_size=len(stored_univ.symbols),
                        candidates=held,
                    ),
                    snapshot,
                    universe_size=len(stored_univ.symbols),
                )
        pond = list(stored_univ.symbols)
        return attach_list_delta(previous, snapshot, universe=pond, universe_generated_at=univ_at)

    snapshot = await run_position_scan_async(universe=curated)
    set_position_scan_snapshot_cache(snapshot)
    _persist_position_scan_snapshot(snapshot)

    try:
        from stocvest.api.services.position_universe import build_live_scan_universe

        extra_universe = await build_live_scan_universe()
        extra = [symbol for symbol in extra_universe if symbol not in set(curated)]
    except Exception as exc:  # noqa: BLE001 — never fail the worker on universe build
        _LOG.warning("live scan universe build failed: %s", type(exc).__name__)
        extra = []

    pond = curated + extra
    univ_at = datetime.now(timezone.utc)
    _safe_put_universe(PositionScanUniverse(symbols=pond, generated_at=univ_at, source="live"))
    if extra:
        more = await run_position_scan_async(universe=extra)
        snapshot = merge_scan_snapshots(snapshot, more, universe_size=len(pond))
    return attach_list_delta(previous, snapshot, universe=pond, universe_generated_at=univ_at)


def get_cached_position_scan_snapshot() -> PositionScanSnapshot | None:
    """Return the in-process snapshot if one exists, WITHOUT ever computing.

    Conversational callers (the assistant's gem discovery / lookup) use this so a
    cold or stale cache degrades gracefully — pointing the user to ``/dashboard/invest``
    — instead of blocking a chat turn on a full universe composite scan. The snapshot
    is returned regardless of the soft 6h TTL because the underlying data is weekly, so
    a few-hours-stale list is still a good chat answer. Returns None only when nothing
    has been scanned yet in this process (the invest page / candidates API populate it;
    full POS-D15 persists it to Dynamo/S3 so it is effectively always warm).
    """
    cached = _snapshot_cache
    if cached is not None:
        return cached[1]
    # Cold in-process cache: hydrate from the persisted weekly-batch snapshot if one exists
    # (POS-D15). Lazy import avoids a module import cycle; any failure degrades to None.
    try:
        from stocvest.api.services.position_scan_store import get_position_scan_store

        stored = get_position_scan_store().get()
    except Exception:  # noqa: BLE001 — store is best-effort
        stored = None
    if stored is not None:
        set_position_scan_snapshot_cache(stored)
    return stored


def _persist_position_scan_snapshot(snapshot: PositionScanSnapshot) -> None:
    """Best-effort cross-instance persist so the next cold Lambda can skip a live scan."""
    try:
        from stocvest.api.services.position_scan_store import get_position_scan_store

        get_position_scan_store().put(snapshot)
    except Exception:  # noqa: BLE001 — persistence must never fail the request path
        _LOG.warning("position scan persist failed")


_compute_lock = threading.Lock()


def compute_and_persist_position_scan() -> PositionScanSnapshot:
    """Full universe compose + persist. Workers / async refresh only — never the HTTP path.

    A cold compose regularly exceeds the API Gateway ~29s cap. The GET handler
    returns ``{pending: true}`` and fires this via async self-invoke.
    """
    global _snapshot_cache
    with _compute_lock:
        snapshot = asyncio.run(_run_live_position_scan())
        now = time.time()
        with _cache_lock:
            _snapshot_cache = (now + _SCAN_TTL_SECONDS, snapshot)
        _persist_position_scan_snapshot(snapshot)
        return snapshot


def get_position_scan_snapshot_sync(*, force: bool = False) -> tuple[PositionScanSnapshot | None, bool]:
    """Return (snapshot, cached) from in-process + store only.

    Request-path rule: never compose the universe here. An empty store plus a live
    25-name scan exceeds the HTTP API ~29s cap and the invest page then shows
    "unavailable". ``force=True`` still recomputes (workers / tests). HTTP handlers
    must not pass ``force=True`` — they kick :func:`compute_and_persist_position_scan`
    off the request path.
    """
    if force:
        return compute_and_persist_position_scan(), False
    stored = get_cached_position_scan_snapshot()
    if stored is not None:
        return stored, True
    return None, False

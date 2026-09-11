"""Position universe scan (POS-D15 stub) — ranked gem candidates.

v1 lite: a curated, liquid US large-cap universe is composited (concurrently),
scored through the transparent gem gates (G1-G9), ranked by ``gem_rank``, and
cached as a :class:`PositionScanSnapshot`. This backs
``GET /v1/signals/position/candidates`` and the ``/dashboard/invest`` home.

Full weekly batch + FMP pre-filter + ~500-name universe scales after POS-D9
(see ADR-004 POS-D15 contract). Everything here is dependency-injectable so the
gate/rank/sort logic is unit-testable without network.
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
    TIER_INSUFFICIENT,
    build_gem_why,
    compute_gem_rank,
    evaluate_gem_gates,
    extract_candidate_features,
    failing_gates,
    resolve_gem_action,
    resolve_gem_tier,
    tier_sort_key,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# v1 lite universe — liquid US large caps across sectors (≥$2B cap, ≥$20M ADV
# by construction). Scales to ~500 names via weekly batch in POS-D15 full.
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
    global _snapshot_cache
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
        )


@dataclass(frozen=True)
class PositionScanSnapshot:
    generated_at: datetime
    universe_size: int
    candidates: list[GemCandidate] = field(default_factory=list)

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
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }

    def to_store_dict(self) -> dict[str, Any]:
        """Full snapshot blob for cross-instance persistence (POS-D15 weekly batch)."""
        return {
            "generated_at": self.generated_at.replace(microsecond=0).isoformat(),
            "universe_size": self.universe_size,
            "candidates": [c.to_api_dict() for c in self.candidates],
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
        return cls(
            generated_at=gen,
            universe_size=int(d.get("universe_size") or len(cands)),
            candidates=cands,
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


def get_position_scan_snapshot_sync(*, force: bool = False) -> tuple[PositionScanSnapshot, bool]:
    """Return (snapshot, cached). Recomputes (fresh asyncio loop) when stale or forced.

    Loop-agnostic: cache coherence is guarded by a threading.Lock so repeated warm
    invocations never trip asyncio's per-loop binding.
    """
    global _snapshot_cache
    now = time.time()
    cached = _snapshot_cache
    if not force and cached is not None and cached[0] > now:
        return cached[1], True
    with _cache_lock:
        now = time.time()
        cached = _snapshot_cache
        if not force and cached is not None and cached[0] > now:
            return cached[1], True
        snapshot = run_position_scan()
        _snapshot_cache = (now + _SCAN_TTL_SECONDS, snapshot)
        return snapshot, False

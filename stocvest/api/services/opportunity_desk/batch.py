"""
Opportunity Desk scheduled batch — funnel (Steps 1–3) + bounded composite (Step 5).

Writes versioned envelopes to Upstash via :func:`stocvest.data.dashboard_cache.write_dashboard_cache`.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from stocvest.api.services.opportunity_desk.discovery_row import (
    DeskMode,
    discovery_row_from_mover,
    movers_radar_payload,
    retained_pool_payload,
)
from stocvest.api.services.opportunity_desk.funnel import (
    OpportunityDeskFunnelConfig,
    OpportunityDeskFunnelResult,
    diff_desk_snapshots,
    run_snapshot_funnel,
)
from stocvest.api.services.opportunity_desk.metrics import publish_opportunity_desk_batch_metrics
from stocvest.api.services.opportunity_desk.quiet_leaders import build_quiet_leaders
from stocvest.api.services.opportunity_desk.snapshot_load import load_us_equity_snapshots_for_funnel
from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.data import PolygonClient
from stocvest.data.corporate_actions import recent_split_symbols, symbols_with_frequent_reverse_splits
from stocvest.data.ticker_reference_cache import filter_symbols_by_reference_eligibility
from stocvest.data.dashboard_cache import (
    DashboardKeys,
    read_dashboard_cache,
    write_dashboard_cache,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)
_ET = ZoneInfo("America/New_York")

DeskBatchTier = Literal["full", "movers"]

RECENTLY_HOT_MAX = 10
RECENTLY_HOT_TTL_HOURS = 24


def opportunity_desk_redis_key(mode: DeskMode) -> str:
    return DashboardKeys.OPPORTUNITY_DESK_SWING if mode == "swing" else DashboardKeys.OPPORTUNITY_DESK_DAY


@dataclass
class OpportunityDeskBatchConfig:
    funnel: OpportunityDeskFunnelConfig = field(default_factory=OpportunityDeskFunnelConfig)
    composite_limit_swing: int = 12
    composite_limit_day: int = 8
    composite_concurrency: int = 3


DEFAULT_BATCH_CONFIG = OpportunityDeskBatchConfig()


def _parse_recently_hot(existing: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not existing:
        return []
    raw = existing.get("recently_hot")
    if not isinstance(raw, list):
        return []
    return [x for x in raw if isinstance(x, dict)]


def _prune_recently_hot(rows: list[dict[str, Any]], *, now: datetime) -> list[dict[str, Any]]:
    cutoff = now - timedelta(hours=RECENTLY_HOT_TTL_HOURS)
    kept: list[dict[str, Any]] = []
    for row in rows:
        dropped_at = row.get("dropped_at")
        if not isinstance(dropped_at, str):
            continue
        try:
            ts = datetime.fromisoformat(dropped_at.replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts >= cutoff:
            kept.append(row)
    return kept[:RECENTLY_HOT_MAX]


def build_recently_hot(
    *,
    previous_data: dict[str, Any] | None,
    discovery_rows: list[dict[str, Any]],
    movers_by_symbol: dict[str, Any],
    now: datetime,
) -> list[dict[str, Any]]:
    prev_symbols = [
        str(r.get("symbol") or "").strip().upper()
        for r in (previous_data or {}).get("discovery") or []
        if isinstance(r, dict)
    ]
    cur_symbols = [str(r.get("symbol") or "").strip().upper() for r in discovery_rows]
    diff = diff_desk_snapshots(prev_symbols, cur_symbols)
    dropped_at = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    fresh: list[dict[str, Any]] = []
    for sym in diff.dropped:
        mover = movers_by_symbol.get(sym)
        fresh.append(
            {
                "symbol": sym,
                "dropped_at": dropped_at,
                "gap_percent": getattr(mover, "gap_percent", None),
                "reason": "dropped_from_discovery",
            }
        )
    merged = fresh + _prune_recently_hot(_parse_recently_hot(previous_data), now=now)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in merged:
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(row)
        if len(out) >= RECENTLY_HOT_MAX:
            break
    return out


async def _composite_swing(symbol: str) -> dict[str, Any] | None:
    try:
        return await asyncio.to_thread(
            swing_composite_body_sync,
            symbol=symbol,
            user_id=None,
            ledger_capture=False,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("opportunity_desk swing composite failed %s: %s", symbol, exc)
        return None


async def _composite_day(symbol: str) -> dict[str, Any] | None:
    try:
        return await asyncio.to_thread(
            real_composite_body_sync,
            symbol=symbol,
            user_id=None,
            ledger_capture=False,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("opportunity_desk day composite failed %s: %s", symbol, exc)
        return None


async def _composite_for_mode(symbol: str, mode: DeskMode) -> dict[str, Any] | None:
    if mode == "day":
        return await _composite_day(symbol)
    return await _composite_swing(symbol)


async def _build_discovery_rows(
    movers: tuple[Any, ...],
    *,
    mode: DeskMode,
    limit: int,
    concurrency: int,
) -> tuple[list[dict[str, Any]], int]:
    sem = asyncio.Semaphore(max(1, concurrency))
    targets = list(movers[: max(0, limit)])
    composite_failures = 0

    async def one(mover: Any) -> dict[str, Any]:
        nonlocal composite_failures
        async with sem:
            composite = await _composite_for_mode(mover.symbol, mode)
        if composite is None:
            composite_failures += 1
        return discovery_row_from_mover(mover, mode=mode, composite=composite)

    if not targets:
        return [], 0
    rows = list(await asyncio.gather(*[one(m) for m in targets]))
    return rows, composite_failures


def _desk_payload_base(
    funnel: OpportunityDeskFunnelResult,
    *,
    snapshot_source: str,
    tier: DeskBatchTier,
    session_trading_date: str,
    rejected_samples_window: list[dict[str, str]],
) -> dict[str, Any]:
    fcfg = DEFAULT_BATCH_CONFIG.funnel
    return {
        "tier": tier,
        "snapshot_source": snapshot_source,
        "scanned_snapshot_count": funnel.scanned_snapshot_count,
        "eligible_symbol_count": funnel.eligible_symbol_count,
        "survivor_limit_used": funnel.survivor_limit_used,
        "movers_radar": movers_radar_payload(funnel.movers, limit=fcfg.movers_radar_limit),
        "retained_pool": retained_pool_payload(funnel.movers),
        "rejection_reason_counts": funnel.rejection_reason_counts,
        "rejected_samples": rejected_samples_window,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "session_trading_date": session_trading_date,
    }


def _default_batch_config_from_settings() -> OpportunityDeskBatchConfig:
    try:
        settings = get_settings()
        funnel = OpportunityDeskFunnelConfig(
            survivor_limit=max(1, int(settings.opportunity_desk_survivor_limit)),
            adaptive_survivor_limit=bool(settings.opportunity_desk_adaptive_survivor_limit),
            elevated_survivor_limit=max(1, int(settings.opportunity_desk_elevated_survivor_limit)),
            elevated_breadth_trigger=max(1, int(settings.opportunity_desk_elevated_breadth_trigger)),
        )
        return OpportunityDeskBatchConfig(funnel=funnel)
    except Exception:
        return DEFAULT_BATCH_CONFIG


def _parse_rejected_samples(existing: dict[str, Any] | None) -> list[dict[str, str]]:
    if not existing:
        return []
    raw = existing.get("rejected_samples")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip().upper()
        reason = str(row.get("reason") or "").strip()
        seen_at = str(row.get("seen_at") or "").strip()
        if sym and reason and seen_at:
            out.append({"symbol": sym, "reason": reason, "seen_at": seen_at})
    return out


def _merge_rejected_samples_window(
    *,
    previous_data: dict[str, Any] | None,
    current_samples: tuple[Any, ...],
    now: datetime,
    max_rows: int = 120,
    ttl_hours: int = 24,
) -> list[dict[str, str]]:
    cutoff = now - timedelta(hours=max(1, ttl_hours))
    current_seen_at = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    merged: list[dict[str, str]] = []
    seen_keys: set[str] = set()
    for s in current_samples:
        sym = str(getattr(s, "symbol", "") or "").strip().upper()
        reason = str(getattr(s, "reason", "") or "").strip()
        if not sym or not reason:
            continue
        key = f"{sym}::{reason}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        merged.append({"symbol": sym, "reason": reason, "seen_at": current_seen_at})
    for row in _parse_rejected_samples(previous_data):
        key = f"{row['symbol']}::{row['reason']}"
        if key in seen_keys:
            continue
        try:
            ts = datetime.fromisoformat(row["seen_at"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts < cutoff:
            continue
        seen_keys.add(key)
        merged.append(row)
        if len(merged) >= max_rows:
            break
    return merged[:max_rows]


async def run_opportunity_desk_batch(
    *,
    tier: DeskBatchTier = "full",
    config: OpportunityDeskBatchConfig | None = None,
) -> dict[str, Any]:
    """
    Run Opportunity Desk batch for swing + day caches.

    ``tier=movers`` refreshes snapshot math and movers_radar only (preserves discovery).
    ``tier=full`` also rebuilds discovery leaders with bounded composite scoring.
    """
    started = time.perf_counter()
    composite_failures_total = 0
    cfg = config or _default_batch_config_from_settings()
    session_trading_date = datetime.now(_ET).date().isoformat()
    snapshots, snapshot_source = await load_us_equity_snapshots_for_funnel()
    recent_splits: frozenset[str] = frozenset()
    frequent_reverse: frozenset[str] = frozenset()
    funnel: OpportunityDeskFunnelResult
    try:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            recent_splits, frequent_reverse = await asyncio.gather(
                recent_split_symbols(client),
                symbols_with_frequent_reverse_splits(client),
            )
            funnel = run_snapshot_funnel(
                snapshots,
                cfg.funnel,
                recent_split_symbols=recent_splits,
                frequent_reverse_split_symbols=frequent_reverse,
            )
            if funnel.movers:
                snapshots_by_symbol = {s.symbol.strip().upper(): s for s in snapshots if s.symbol}
                allowed = await filter_symbols_by_reference_eligibility(
                    client,
                    [m.symbol for m in funnel.movers],
                    snapshots_by_symbol,
                    recent_split_symbols=recent_splits,
                    frequent_reverse_split_symbols=frequent_reverse,
                    mode="swing",
                    concurrency=8,
                )
                if allowed != {m.symbol for m in funnel.movers}:
                    filtered_movers = tuple(m for m in funnel.movers if m.symbol in allowed)
                    funnel = OpportunityDeskFunnelResult(
                        movers=filtered_movers,
                        eligible_symbol_count=len(filtered_movers),
                        scanned_snapshot_count=funnel.scanned_snapshot_count,
                        survivor_limit_used=min(
                            funnel.survivor_limit_used,
                            len(filtered_movers),
                        ),
                        rejection_reason_counts=funnel.rejection_reason_counts,
                        rejected_samples=funnel.rejected_samples,
                    )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("opportunity_desk corporate_actions / reference filter failed: %s", str(exc)[:200])
        funnel = run_snapshot_funnel(snapshots, cfg.funnel)
    movers_by_symbol = {m.symbol: m for m in funnel.movers}
    quiet_leaders_swing: list[dict[str, Any]] = []
    if tier == "full":
        try:
            quiet_leaders_swing = await build_quiet_leaders(
                snapshots,
                funnel.movers,
                composite_fn=lambda sym: _composite_for_mode(sym, "swing"),
                funnel_cfg=cfg.funnel,
                recent_split_symbols=recent_splits,
                frequent_reverse_split_symbols=frequent_reverse,
            )
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("opportunity_desk quiet_leaders failed: %s", exc)
    now = datetime.now(timezone.utc)
    results: dict[str, Any] = {
        "tier": tier,
        "snapshot_source": snapshot_source,
        "scanned_snapshot_count": funnel.scanned_snapshot_count,
        "eligible_symbol_count": funnel.eligible_symbol_count,
        "modes": {},
    }

    for mode in ("swing", "day"):
        mode_lit: DeskMode = mode  # type: ignore[assignment]
        key = opportunity_desk_redis_key(mode_lit)
        previous_envelope = read_dashboard_cache(key)
        previous_data = (
            previous_envelope.get("data")
            if isinstance(previous_envelope, dict) and isinstance(previous_envelope.get("data"), dict)
            else None
        )
        payload = _desk_payload_base(
            funnel,
            snapshot_source=snapshot_source,
            tier=tier,
            session_trading_date=session_trading_date,
            rejected_samples_window=_merge_rejected_samples_window(
                previous_data=previous_data,
                current_samples=funnel.rejected_samples,
                now=now,
            ),
        )

        if tier == "full":
            composite_limit = (
                cfg.composite_limit_swing if mode_lit == "swing" else cfg.composite_limit_day
            )
            discovery, composite_failures = await _build_discovery_rows(
                funnel.movers,
                mode=mode_lit,
                limit=composite_limit,
                concurrency=cfg.composite_concurrency,
            )
            composite_failures_total += composite_failures
            # Pad with funnel-only rows up to discovery_display_limit if composite batch was smaller
            disc_syms = {r["symbol"] for r in discovery}
            for mover in funnel.movers:
                if len(discovery) >= cfg.funnel.discovery_display_limit:
                    break
                if mover.symbol in disc_syms:
                    continue
                discovery.append(discovery_row_from_mover(mover, mode=mode_lit, composite=None))
            discovery = discovery[: cfg.funnel.discovery_display_limit]
            payload["discovery"] = discovery
            payload["recently_hot"] = build_recently_hot(
                previous_data=previous_data,
                discovery_rows=discovery,
                movers_by_symbol=movers_by_symbol,
                now=now,
            )
            if mode_lit == "swing":
                payload["quiet_leaders"] = quiet_leaders_swing
            else:
                payload["quiet_leaders"] = []
        else:
            if isinstance(previous_data, dict):
                payload["discovery"] = previous_data.get("discovery") or []
                payload["recently_hot"] = _prune_recently_hot(
                    _parse_recently_hot(previous_data),
                    now=now,
                )
                payload["quiet_leaders"] = (
                    quiet_leaders_swing
                    if mode_lit == "swing"
                    else list(previous_data.get("quiet_leaders") or [])
                )
            else:
                payload["discovery"] = []
                payload["recently_hot"] = []
                payload["quiet_leaders"] = quiet_leaders_swing if mode_lit == "swing" else []

        written = write_dashboard_cache(
            key,
            payload,
            f"opportunity_desk_{mode_lit}",  # mode-specific TTL: swing=4 days, day=intraday
            mode_lit,
        )
        results["modes"][mode] = {
            "written": written,
            "discovery_count": len(payload.get("discovery") or []),
            "movers_radar_count": len(payload.get("movers_radar") or []),
        }
        _LOG.info(
            "opportunity_desk_batch mode=%s tier=%s written=%s discovery=%s eligible=%s source=%s",
            mode,
            tier,
            written,
            len(payload.get("discovery") or []),
            funnel.eligible_symbol_count,
            snapshot_source,
        )

    duration_ms = (time.perf_counter() - started) * 1000.0
    publish_opportunity_desk_batch_metrics(
        tier=tier,
        duration_ms=duration_ms,
        survivor_count=funnel.eligible_symbol_count,
        composite_failures=composite_failures_total,
        scanned_snapshot_count=funnel.scanned_snapshot_count,
    )
    results["batch_duration_ms"] = round(duration_ms, 2)
    results["composite_failures"] = composite_failures_total
    return results


def run_opportunity_desk_batch_sync(*, tier: DeskBatchTier = "full") -> dict[str, Any]:
    return asyncio.run(run_opportunity_desk_batch(tier=tier))

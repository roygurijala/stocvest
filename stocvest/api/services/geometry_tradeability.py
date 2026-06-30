"""Desk geometry tradeability — when a composite may surface on desk / scanner feeds.

A symbol with bullish layers but degenerate stop/target geometry (no_clean_entry,
sub-desk structure R/R, incomplete signal) must not appear as a tradable setup card.
"""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.services.market_environment import min_risk_reward_from_environment
from stocvest.api.services.risk_reward_structure import structure_risk_reward_long, structure_risk_reward_short
from stocvest.signals.composite_score import CompositeVerdict

Mode = Literal["day", "swing"]


def _float_or_none(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f and f > 0 else None
    except (TypeError, ValueError):
        return None


def _entry_from_body(body: dict[str, Any]) -> float | None:
    for key in ("last_trade_price", "price_at_signal"):
        p = _float_or_none(body.get(key))
        if p is not None:
            return p
    snap = body.get("snapshot")
    if isinstance(snap, dict):
        p = _float_or_none(snap.get("last_trade_price"))
        if p is not None:
            return p
    return None


def _verdict_from_body(body: dict[str, Any]) -> CompositeVerdict:
    raw = body.get("verdict") or body.get("signal_summary")
    if raw is None:
        return CompositeVerdict.NEUTRAL
    s = str(raw).strip().lower()
    if s in ("bullish", "bull"):
        return CompositeVerdict.BULLISH
    if s in ("bearish", "bear"):
        return CompositeVerdict.BEARISH
    try:
        return CompositeVerdict(str(raw).strip().lower())
    except ValueError:
        return CompositeVerdict.NEUTRAL


def _use_long_rr(body: dict[str, Any], *, entry: float | None) -> bool:
    verdict = _verdict_from_body(body)
    if verdict == CompositeVerdict.BULLISH:
        return True
    if verdict == CompositeVerdict.BEARISH:
        return False
    day_lo = _float_or_none(body.get("day_low"))
    day_hi = _float_or_none(body.get("day_high"))
    if day_lo is None or day_hi is None or day_hi <= day_lo or entry is None:
        return True
    mid = (day_lo + day_hi) / 2.0
    return entry >= mid


def structure_rr_from_body(body: dict[str, Any]) -> float | None:
    """Honest structure R/R from served reference levels, or None when geometry fails."""
    entry = _entry_from_body(body)
    stop = _float_or_none(body.get("reference_stop_level"))
    t1 = _float_or_none(body.get("reference_target_1"))
    t2 = _float_or_none(body.get("reference_target_2"))
    prov_raw = body.get("reference_target_2_provenance")
    prov = str(prov_raw).strip() if isinstance(prov_raw, str) and prov_raw.strip() else None
    if entry is None or stop is None or t1 is None:
        return None
    use_long = _use_long_rr(body, entry=entry)
    if use_long:
        return structure_risk_reward_long(entry, t1, stop, t2, prov)
    return structure_risk_reward_short(entry, t1, stop, t2, prov)


def geometry_tradeability(
    body: dict[str, Any] | None,
    *,
    mode: Mode,
) -> tuple[bool, str | None]:
    """Return ``(desk_surface_eligible, block_reason)``."""
    if not body or not isinstance(body, dict):
        return False, "missing_composite"
    status = str(body.get("status") or "").strip().lower()
    if status in ("incomplete", "insufficient_data"):
        return False, status or "incomplete"
    if body.get("error"):
        return False, "composite_error"
    verdict = _verdict_from_body(body)
    if verdict == CompositeVerdict.NEUTRAL:
        return False, "neutral_verdict"
    eq = str(body.get("entry_zone_quality") or "").strip().lower()
    if eq == "no_clean_entry":
        return False, "no_clean_entry"
    rr = structure_rr_from_body(body)
    if rr is None:
        return False, "geometry_insufficient"
    env = body.get("market_environment")
    env_dict = env if isinstance(env, dict) else None
    min_rr_raw = body.get("min_rr_desk")
    if isinstance(min_rr_raw, (int, float)) and float(min_rr_raw) > 0:
        min_rr = float(min_rr_raw)
    else:
        min_rr = min_risk_reward_from_environment(env_dict, mode=mode)
    if rr < min_rr:
        return False, "rr_below_desk_min"
    return True, None


def annotate_setup_rows_surface_eligibility(
    rows: list[dict[str, Any]],
    *,
    mode: Mode,
) -> list[dict[str, Any]]:
    """Attach ``desk_surface_eligible`` from cached composite evidence (if any)."""
    from stocvest.data.dashboard_cache import evidence_cache_key, read_dashboard_cache

    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        copy = dict(row)
        sym = str(copy.get("symbol") or "").strip().upper()
        if not sym:
            out.append(copy)
            continue
        envelope = read_dashboard_cache(evidence_cache_key(sym, mode))
        body = envelope.get("data") if isinstance(envelope, dict) else None
        if isinstance(body, dict) and not body.get("error"):
            eligible, reason = geometry_tradeability(body, mode=mode)
            copy["desk_surface_eligible"] = eligible
            copy["geometry_block_reason"] = reason
        else:
            copy["desk_surface_eligible"] = False
            copy["geometry_block_reason"] = "missing_composite"
        out.append(copy)
    return out


def filter_surface_eligible_setup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if isinstance(row, dict) and row.get("desk_surface_eligible") is True]


def filter_setups_bundle_by_geometry(bundle: dict[str, Any], *, mode: Mode) -> dict[str, Any]:
    """Drop scanner/desk setup rows that fail geometry tradeability."""
    out = dict(bundle)
    for key in ("qualifying", "near_qualification"):
        block = out.get(key)
        if not isinstance(block, list):
            continue
        needs_annotation = any(
            isinstance(row, dict) and "desk_surface_eligible" not in row for row in block
        )
        annotated = (
            annotate_setup_rows_surface_eligibility(block, mode=mode)
            if needs_annotation
            else block
        )
        out[key] = filter_surface_eligible_setup_rows(annotated)
    return out

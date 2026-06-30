"""Serialize discovery leader rows from funnel movers + optional composite bodies."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.services.geometry_tradeability import geometry_tradeability
from stocvest.api.services.opportunity_desk.funnel import FunnelMover

DeskMode = Literal["swing", "day"]


def execution_hint_from_composite(body: dict[str, Any] | None, *, mode: DeskMode) -> str | None:
    if not body or not isinstance(body, dict):
        return None
    eligible, reason = geometry_tradeability(body, mode=mode)
    if not eligible:
        if reason == "no_clean_entry":
            return "Not tradable — no clean entry band at current structure."
        if reason == "geometry_insufficient":
            return "Not tradable — stop/target geometry insufficient for desk R/R."
        if reason == "rr_below_desk_min":
            rr_raw = body.get("structure_risk_reward")
            if rr_raw is None:
                rr_raw = body.get("risk_reward")
            if isinstance(rr_raw, (int, float)):
                return f"Not tradable — structure R/R {float(rr_raw):.1f}:1 below desk minimum."
            return "Not tradable — structure R/R below desk minimum."
        if reason:
            return f"Not tradable — {str(reason).replace('_', ' ')}."
    rr_raw = body.get("structure_risk_reward")
    if rr_raw is None:
        rr_raw = body.get("risk_reward")
    rr: float | None = float(rr_raw) if isinstance(rr_raw, (int, float)) else None
    if mode == "swing" and rr is not None and rr < 2.0:
        return f"Strong setup quality — execution blocked by risk/reward ({rr:.1f}:1)."
    eq = body.get("execution_quality")
    if isinstance(eq, dict):
        band = str(eq.get("band") or "").strip().lower()
        if band == "weak":
            return "Execution quality weak — review Signals for full context."
    return None


def discovery_row_from_mover(
    mover: FunnelMover,
    *,
    mode: DeskMode,
    composite: dict[str, Any] | None = None,
) -> dict[str, Any]:
    alignment_ratio: float | None = None
    verdict: str | None = None
    rr: float | None = None
    status: str | None = None
    if composite and isinstance(composite, dict):
        status = str(composite.get("status") or "").strip() or None
        verdict_raw = composite.get("signal_summary") or composite.get("verdict")
        if verdict_raw is not None:
            verdict = str(verdict_raw)
        ar = composite.get("alignment_ratio")
        if isinstance(ar, (int, float)):
            alignment_ratio = float(ar)
        alignment = composite.get("alignment")
        if alignment_ratio is None and isinstance(alignment, dict):
            score = alignment.get("score")
            if isinstance(score, (int, float)):
                alignment_ratio = float(score)
        rr_raw = composite.get("risk_reward")
        if isinstance(rr_raw, (int, float)):
            rr = float(rr_raw)

    execution_actionable: bool | None = None
    decision_state: str | None = None
    direction_confidence: str | None = None
    desk_surface_eligible: bool | None = None
    geometry_block_reason: str | None = None
    if composite and isinstance(composite, dict):
        if "execution_actionable" in composite:
            execution_actionable = bool(composite.get("execution_actionable"))
        ds = composite.get("decision_state")
        if isinstance(ds, str) and ds.strip():
            decision_state = ds.strip()
        dc = composite.get("direction_confidence")
        if isinstance(dc, str) and dc.strip() in ("High", "Moderate", "Low"):
            direction_confidence = dc.strip()
        if "desk_surface_eligible" in composite:
            desk_surface_eligible = bool(composite.get("desk_surface_eligible"))
        else:
            eligible, block = geometry_tradeability(composite, mode=mode)
            desk_surface_eligible = eligible
            geometry_block_reason = block
        raw_reason = composite.get("geometry_block_reason")
        if isinstance(raw_reason, str) and raw_reason.strip():
            geometry_block_reason = raw_reason.strip()
        elif desk_surface_eligible is False and geometry_block_reason is None:
            _, geometry_block_reason = geometry_tradeability(composite, mode=mode)

    row: dict[str, Any] = {
        "symbol": mover.symbol,
        "gap_percent": mover.gap_percent,
        "direction": mover.direction,
        "rank_score": mover.rank_score,
        "day_volume": mover.day_volume,
        "session_price": mover.session_price,
        "desk": mode,
        "verdict": verdict,
        "alignment_ratio": alignment_ratio,
        "risk_reward": rr,
        "composite_status": status,
        "execution_hint": execution_hint_from_composite(composite, mode=mode),
        "execution_actionable": execution_actionable,
        "decision_state": decision_state,
        "direction_confidence": direction_confidence,
        "desk_surface_eligible": desk_surface_eligible,
        "geometry_block_reason": geometry_block_reason,
    }
    return row


def movers_radar_payload(movers: tuple[FunnelMover, ...], *, limit: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in movers[: max(0, limit)]:
        out.append(
            {
                "symbol": m.symbol,
                "gap_percent": m.gap_percent,
                "direction": m.direction,
                "rank_score": m.rank_score,
            }
        )
    return out


def retained_pool_payload(movers: tuple[FunnelMover, ...]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, m in enumerate(movers, start=1):
        out.append(
            {
                "symbol": m.symbol,
                "gap_percent": m.gap_percent,
                "direction": m.direction,
                "rank_score": m.rank_score,
                "day_volume": m.day_volume,
                "session_price": m.session_price,
                "rank_position": idx,
            }
        )
    return out

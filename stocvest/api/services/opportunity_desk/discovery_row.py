"""Serialize discovery leader rows from funnel movers + optional composite bodies."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.services.opportunity_desk.funnel import FunnelMover

DeskMode = Literal["swing", "day"]


def execution_hint_from_composite(body: dict[str, Any] | None, *, mode: DeskMode) -> str | None:
    if not body or not isinstance(body, dict):
        return None
    rr_raw = body.get("risk_reward")
    rr: float | None = None
    if isinstance(rr_raw, (int, float)):
        rr = float(rr_raw)
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

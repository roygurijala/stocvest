"""Bundle qualifying and near-qualification setup rows for scanner v2 consumers."""

from __future__ import annotations

from typing import Any, Callable, Protocol, TypeVar

T = TypeVar("T", covariant=True)


class _SetupCandidate(Protocol):
    symbol: str
    score: float


def alignment_from_triggers(triggers: list[str], *, total_slots: int = 6) -> dict[str, Any]:
    aligned = len(triggers)
    total = max(1, total_slots)
    return {
        "aligned": aligned,
        "total": total,
        "label": f"{aligned}/{total} aligned",
    }


def annotate_near_qualification_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        copy = dict(row)
        copy["qualification_tier"] = "near"
        triggers = copy.get("triggers")
        if isinstance(triggers, list):
            copy["alignment"] = alignment_from_triggers([str(t) for t in triggers])
        out.append(copy)
    return out


def build_near_qualification_candidates(
    candidates: list[T],
    *,
    qualifying_symbols: set[str],
    min_score: float,
    near_min_score: float,
    near_limit: int,
) -> list[T]:
    """Keep rows between ``near_min_score`` and ``min_score`` that are not already qualifying."""
    out: list[T] = []
    for c in candidates:
        sym = str(c.symbol).strip().upper()
        if sym in qualifying_symbols:
            continue
        if c.score >= min_score:
            continue
        if c.score < near_min_score:
            continue
        out.append(c)
        if len(out) >= near_limit:
            break
    return out


def bundle_setups_response(
    qualifying: list[T],
    near_pool: list[T],
    payload: dict[str, Any],
    serialize: Callable[[list[T], dict[str, Any]], list[dict[str, Any]]],
    *,
    min_score: float,
    near_min_score: float,
    near_limit: int,
) -> dict[str, Any]:
    qual_syms = {str(c.symbol).strip().upper() for c in qualifying}
    near = build_near_qualification_candidates(
        near_pool,
        qualifying_symbols=qual_syms,
        min_score=min_score,
        near_min_score=near_min_score,
        near_limit=near_limit,
    )
    return {
        "qualifying": serialize(qualifying, payload),
        "near_qualification": annotate_near_qualification_rows(serialize(near, payload)),
    }

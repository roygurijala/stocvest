"""Position gem discovery + lookup context for the STOCVEST Assistant (ADR-004 POS-D10).

Two long-horizon investment journeys, both read-only against the POS-D15 position
candidates snapshot (:func:`get_position_scan_snapshot_sync`) — never the swing/day
scanner:

* Journey A — discovery ("what are today's gems?", "find strong long-term stocks"):
  top gem/strong candidates with their deterministic tier + one-line reason.
* Journey B — single-name lookup ("is MSFT a gem?"): the symbol's cached tier, pillars,
  and reason if it is in the weekly universe; otherwise an explicit "not on the gem list"
  note so the assistant offers the Position tab instead of guessing a tier.
* Journey C — head-to-head compare ("compare KO vs PEP for the long term", POS-AI-6): a
  deterministic pillar diff matrix across 2–4 cached candidates that presents differences
  only — the assistant never crowns a single "best" pick.

The assistant only *narrates* these; the tier is the fixed output of gates G1–G9 and is
never invented, upgraded, or overridden.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from stocvest.api.services.position_scan import GemCandidate, get_cached_position_scan_snapshot
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# More than a handful of gems is a wall of text with no added insight.
_MAX_GEMS = 6
_INVEST_HREF = "/dashboard/invest"


# ── Journey A — discovery ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class GemRow:
    symbol: str
    tier: str
    verdict: str
    fundamentals_verdict: str
    weakest_pillar_label: str | None
    why: str


@dataclass
class PositionGemResult:
    rows: list[GemRow] = field(default_factory=list)
    source: str = "scan_cache"  # scan_cache | empty | not_loaded | error
    generated_at: str | None = None
    universe_size: int = 0
    has_data: bool = False


def _row(c: GemCandidate) -> GemRow:
    return GemRow(
        symbol=c.symbol,
        tier=c.tier,
        verdict=c.verdict,
        fundamentals_verdict=c.fundamentals_verdict,
        weakest_pillar_label=c.weakest_pillar_label,
        why=c.why,
    )


def fetch_position_gem_context(*, limit: int = _MAX_GEMS) -> PositionGemResult:
    """Top gem (then strong) candidates from the cached weekly position scan."""
    result = PositionGemResult()
    try:
        snapshot = get_cached_position_scan_snapshot()
        if snapshot is None:
            result.source = "not_loaded"
            return result
        result.generated_at = snapshot.generated_at.replace(microsecond=0).isoformat()
        result.universe_size = snapshot.universe_size
        rows = list(snapshot.filtered(tier="gem", limit=limit))
        if len(rows) < limit:
            rows += list(snapshot.filtered(tier="strong", limit=limit - len(rows)))
        result.rows = [_row(c) for c in rows[:limit]]
        result.has_data = bool(result.rows)
        if not result.has_data:
            result.source = "empty"
        return result
    except Exception as exc:  # noqa: BLE001 — discovery must never break the reply
        _LOG.debug("position gem discovery fetch failed: %s", exc)
        result.source = "error"
        return result


def serialize_position_gem_context(result: PositionGemResult) -> str:
    """Render the gem list as a compact context block for Claude."""
    if result.source == "not_loaded":
        return (
            "=== POSITION GEM CANDIDATES ===\n"
            "source=not_loaded\n"
            f"note=The weekly gem scan is not loaded in this session yet. Tell the user to open "
            f"{_INVEST_HREF} to run the screen, then ask again — do NOT invent candidates.\n"
        )
    if result.source == "empty":
        return (
            "=== POSITION GEM CANDIDATES ===\n"
            "source=empty\n"
            "note=No qualified gem candidates in the latest weekly position scan. Say the list is "
            f"empty right now and point the user to {_INVEST_HREF} for the full screen.\n"
        )
    if not result.has_data:
        return ""
    lines = ["=== POSITION GEM CANDIDATES (long-horizon; deterministic tier) ==="]
    if result.generated_at:
        lines.append(f"scan_generated_at={result.generated_at}")
    lines.append(f"universe_size={result.universe_size}")
    lines.append(f"invest_href={_INVEST_HREF}")
    lines.append(f"top_{len(result.rows)}:")
    for r in result.rows:
        weak = f"; weakest {r.weakest_pillar_label}" if r.weakest_pillar_label else ""
        lines.append(
            f"  - {r.symbol}: tier={r.tier}, fundamentals={r.fundamentals_verdict}{weak} — {r.why}"
        )
    lines.append("")
    return "\n".join(lines)


def position_gem_payload(result: PositionGemResult) -> dict[str, Any] | None:
    """Structured gem rows for the assistant UI (compact ranked card). None when empty."""
    if not result.has_data or not result.rows:
        return None
    return {
        "source": result.source,
        "generated_at": result.generated_at,
        "universe_size": result.universe_size,
        "invest_href": _INVEST_HREF,
        "rows": [
            {
                "symbol": r.symbol,
                "tier": r.tier,
                "fundamentals_verdict": r.fundamentals_verdict,
                "weakest_pillar_label": r.weakest_pillar_label,
                "why": r.why,
            }
            for r in result.rows
        ],
    }


# ── Journey B — single-name lookup ────────────────────────────────────────────


@dataclass
class GemLookupResult:
    symbol: str
    found: bool = False
    tier: str | None = None
    verdict: str | None = None
    fundamentals_verdict: str | None = None
    weakest_pillar_label: str | None = None
    why: str | None = None
    pillars: list[dict[str, Any]] = field(default_factory=list)
    generated_at: str | None = None
    source: str = "scan_cache"  # scan_cache | not_on_universe | not_loaded | error


def fetch_gem_lookup_context(symbol: str) -> GemLookupResult:
    """Look up one symbol's tier/pillars in the cached position scan (Journey B)."""
    sym = str(symbol or "").strip().upper()
    res = GemLookupResult(symbol=sym)
    if not sym:
        res.source = "error"
        return res
    try:
        snapshot = get_cached_position_scan_snapshot()
        if snapshot is None:
            res.source = "not_loaded"
            return res
        res.generated_at = snapshot.generated_at.replace(microsecond=0).isoformat()
        for c in snapshot.candidates:
            if c.symbol == sym:
                res.found = True
                res.tier = c.tier
                res.verdict = c.verdict
                res.fundamentals_verdict = c.fundamentals_verdict
                res.weakest_pillar_label = c.weakest_pillar_label
                res.why = c.why
                res.pillars = list(c.pillars)
                return res
        res.source = "not_on_universe"
        return res
    except Exception as exc:  # noqa: BLE001 — lookup must never break the reply
        _LOG.debug("gem lookup fetch failed symbol=%s err=%s", sym, exc)
        res.source = "error"
        return res


def serialize_gem_lookup_context(result: GemLookupResult) -> str:
    """Render a single-name gem lookup as a context block for Claude."""
    sym = result.symbol
    if result.source == "error" or not sym:
        return ""
    if result.source == "not_loaded":
        return (
            f"=== POSITION GEM LOOKUP ({sym}) ===\n"
            "source=not_loaded\n"
            f"note=The weekly gem scan is not loaded in this session yet, so {sym} has no cached "
            f"tier. Tell the user to open {_INVEST_HREF} (or the Position tab for {sym}) for a full "
            "read — do NOT guess a tier.\n"
        )
    if not result.found:
        return (
            f"=== POSITION GEM LOOKUP ({sym}) ===\n"
            "on_gem_list=false\n"
            f"note={sym} is not in the current weekly position universe, so it has no deterministic "
            "gem tier right now. Do NOT guess or assign a tier. Offer to open the Position tab for a "
            f"full glass-box read, and mention the gem list lives at {_INVEST_HREF}.\n"
        )
    lines = [f"=== POSITION GEM LOOKUP ({sym}) ==="]
    if result.generated_at:
        lines.append(f"scan_generated_at={result.generated_at}")
    lines.append(f"tier={result.tier}")
    lines.append(f"fundamentals_verdict={result.fundamentals_verdict}")
    if result.weakest_pillar_label:
        lines.append(f"weakest_pillar={result.weakest_pillar_label}")
    for p in result.pillars:
        pid = str(p.get("pillar_id") or "")
        if not pid:
            continue
        label = str(p.get("label") or pid)
        lines.append(
            f"  pillar {pid} {label}: score={p.get('score')}, verdict={p.get('verdict') or ''}"
        )
    if result.why:
        lines.append(f"why={result.why}")
    lines.append(f"invest_href={_INVEST_HREF}")
    lines.append("")
    return "\n".join(lines)


def gem_lookup_payload(result: GemLookupResult) -> dict[str, Any] | None:
    """Structured single-name lookup for the UI. None when nothing to render."""
    if result.source == "error" or not result.symbol:
        return None
    return {
        "symbol": result.symbol,
        "on_gem_list": result.found,
        "source": result.source,
        "tier": result.tier,
        "fundamentals_verdict": result.fundamentals_verdict,
        "weakest_pillar_label": result.weakest_pillar_label,
        "why": result.why,
        "invest_href": _INVEST_HREF,
    }


# ── Journey C — head-to-head compare (POS-AI-6) ───────────────────────────────
# A deterministic pillar diff matrix across 2–4 cached candidates. Presents *differences*
# only — it never ranks a single "best" pick (that rule is enforced in the locked prompt).

_MAX_COMPARE = 4
_PILLAR_ORDER = ("F1", "F2", "F3", "F4", "F5")


@dataclass
class GemCompareCell:
    symbol: str
    found: bool = False
    tier: str | None = None
    verdict: str | None = None
    fundamentals_verdict: str | None = None
    weakest_pillar_label: str | None = None
    why: str | None = None
    #: pillar_id → {label, score, verdict}
    pillars: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass
class GemCompareResult:
    symbols: list[str] = field(default_factory=list)
    cells: list[GemCompareCell] = field(default_factory=list)
    #: canonical F1..F5 (then any extra ids) present on at least one found cell
    pillar_ids: list[str] = field(default_factory=list)
    generated_at: str | None = None
    source: str = "scan_cache"  # scan_cache | not_loaded | insufficient | error
    found_count: int = 0


def _normalize_compare_symbols(symbols: list[str]) -> list[str]:
    seen: list[str] = []
    for s in symbols or []:
        sym = str(s or "").strip().upper()
        if sym and sym not in seen:
            seen.append(sym)
        if len(seen) >= _MAX_COMPARE:
            break
    return seen


def fetch_gem_compare_context(symbols: list[str]) -> GemCompareResult:
    """Build a deterministic pillar diff matrix across the named symbols (Journey C)."""
    seen = _normalize_compare_symbols(symbols)
    result = GemCompareResult(symbols=seen)
    if len(seen) < 2:
        result.source = "insufficient"
        return result
    try:
        snapshot = get_cached_position_scan_snapshot()
        if snapshot is None:
            result.source = "not_loaded"
            return result
        result.generated_at = snapshot.generated_at.replace(microsecond=0).isoformat()
        by_symbol = {c.symbol: c for c in snapshot.candidates}
        present: set[str] = set()
        for sym in seen:
            cand = by_symbol.get(sym)
            if cand is None:
                result.cells.append(GemCompareCell(symbol=sym, found=False))
                continue
            pillars: dict[str, dict[str, Any]] = {}
            for p in cand.pillars:
                pid = str(p.get("pillar_id") or "").upper()
                if not pid:
                    continue
                pillars[pid] = {
                    "label": str(p.get("label") or pid),
                    "score": p.get("score"),
                    "verdict": str(p.get("verdict") or ""),
                }
                present.add(pid)
            result.cells.append(
                GemCompareCell(
                    symbol=sym,
                    found=True,
                    tier=cand.tier,
                    verdict=cand.verdict,
                    fundamentals_verdict=cand.fundamentals_verdict,
                    weakest_pillar_label=cand.weakest_pillar_label,
                    why=cand.why,
                    pillars=pillars,
                )
            )
        result.found_count = sum(1 for c in result.cells if c.found)
        result.pillar_ids = [pid for pid in _PILLAR_ORDER if pid in present]
        result.pillar_ids += sorted(pid for pid in present if pid not in _PILLAR_ORDER)
        return result
    except Exception as exc:  # noqa: BLE001 — compare must never break the reply
        _LOG.debug("gem compare fetch failed symbols=%s err=%s", seen, exc)
        result.source = "error"
        return result


def serialize_gem_compare_context(result: GemCompareResult) -> str:
    """Render the compare matrix as a context block for Claude (differences, no winner)."""
    if result.source == "error" or not result.symbols:
        return ""
    header = "=== POSITION GEM COMPARE ==="
    if result.source == "insufficient":
        return (
            f"{header}\n"
            "source=insufficient\n"
            "note=Fewer than two named symbols were detected. Ask the user which two-to-four names "
            "to compare — do NOT invent a comparison.\n"
        )
    if result.source == "not_loaded":
        return (
            f"{header}\n"
            "source=not_loaded\n"
            f"note=The weekly gem scan is not loaded in this session yet, so these names have no "
            f"cached tiers. Tell the user to open {_INVEST_HREF} to run the screen — do NOT guess "
            "tiers.\n"
        )
    lines = [
        f"{header} (long-horizon; deterministic tiers — present pillar-by-pillar differences, "
        "NEVER crown a single 'best' pick)"
    ]
    if result.generated_at:
        lines.append(f"scan_generated_at={result.generated_at}")
    lines.append(f"symbols={','.join(result.symbols)}")
    lines.append(f"invest_href={_INVEST_HREF}")
    for cell in result.cells:
        if not cell.found:
            lines.append(
                f"- {cell.symbol}: on_gem_list=false — not in the current weekly universe, so it "
                "has no tier. Do NOT guess a tier; note it is unscored and offer its Position tab."
            )
            continue
        weak = f"; weakest {cell.weakest_pillar_label}" if cell.weakest_pillar_label else ""
        lines.append(f"- {cell.symbol}: tier={cell.tier}, fundamentals={cell.fundamentals_verdict}{weak}")
        for pid in result.pillar_ids:
            p = cell.pillars.get(pid)
            if not p:
                continue
            lines.append(f"    {pid} {p['label']}: score={p['score']}, verdict={p['verdict']}")
    lines.append("")
    return "\n".join(lines)


def gem_compare_payload(result: GemCompareResult) -> dict[str, Any] | None:
    """Structured compare matrix for the UI. None when there is nothing to render."""
    if not result.symbols or result.source in ("error", "insufficient"):
        return None
    return {
        "source": result.source,
        "generated_at": result.generated_at,
        "invest_href": _INVEST_HREF,
        "symbols": result.symbols,
        "pillar_ids": result.pillar_ids,
        "cells": [
            {
                "symbol": cell.symbol,
                "on_gem_list": cell.found,
                "tier": cell.tier,
                "verdict": cell.verdict,
                "fundamentals_verdict": cell.fundamentals_verdict,
                "weakest_pillar_label": cell.weakest_pillar_label,
                "why": cell.why,
                "pillars": cell.pillars,
            }
            for cell in result.cells
        ],
    }

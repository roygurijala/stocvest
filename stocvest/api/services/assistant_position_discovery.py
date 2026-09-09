"""Position gem discovery + lookup context for the STOCVEST Assistant (ADR-004 POS-D10).

Two long-horizon investment journeys, both read-only against the POS-D15 position
candidates snapshot (:func:`get_position_scan_snapshot_sync`) — never the swing/day
scanner:

* Journey A — discovery ("what are today's gems?", "find strong long-term stocks"):
  top gem/strong candidates with their deterministic tier + one-line reason.
* Journey B — single-name lookup ("is MSFT a gem?"): the symbol's cached tier, pillars,
  and reason if it is in the weekly universe; otherwise an explicit "not on the gem list"
  note so the assistant offers the Position tab instead of guessing a tier.

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

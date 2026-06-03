"""
Discovery query service for the STOCVEST Assistant.

When a user asks "what's moving today?", "any momentum stocks?", or similar,
this service reads the cached opportunity desk results (no new scan triggered)
and returns a concise, structured summary Claude can synthesize into a natural
language answer.

Design notes:
* This is deliberately read-only. We pull whatever is in the desk cache; if
  the cache is empty we say so and route to the scanner rather than running a
  fresh scan (which would be too slow and expensive for a chat interaction).
* The result is structured so Claude can explain *why* each symbol appears
  (catalyst, volume, technical setup) rather than just listing tickers.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from stocvest.api.services.opportunity_desk.batch import opportunity_desk_redis_key
from stocvest.data.dashboard_cache import read_dashboard_cache
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Maximum number of top symbols to surface to Claude. More than this produces
# walls of text with no additional insight.
_MAX_SYMBOLS = 5


@dataclass(frozen=True)
class DiscoveryRow:
    symbol: str
    context: str   # one-line plain-English summary of why this symbol is notable


@dataclass
class DiscoveryResult:
    rows: list[DiscoveryRow] = field(default_factory=list)
    source: str = "desk_cache"   # "desk_cache" | "empty_cache" | "error"
    mode: str = "day"
    generated_at: str | None = None
    has_data: bool = False


def fetch_discovery_context(mode: str = "day") -> DiscoveryResult:
    """Read the opportunity desk cache and return a structured discovery summary.

    Returns an empty DiscoveryResult (has_data=False) when the cache is cold
    or unavailable — callers should route the user to the scanner in that case.
    """
    result = DiscoveryResult(mode=mode)
    try:
        key = opportunity_desk_redis_key(mode)  # type: ignore[arg-type]
        envelope = read_dashboard_cache(key)
        if envelope is None:
            result.source = "empty_cache"
            return result

        data = envelope.get("data") if isinstance(envelope, dict) else None
        if not isinstance(data, dict):
            result.source = "empty_cache"
            return result

        result.generated_at = str(envelope.get("generated_at") or "")

        # Pull discovery rows from the desk payload.
        # The desk data structure has "rows" or "discovery_rows" depending on
        # the phase; we try both and fall back to mover symbols.
        rows = _extract_rows(data)
        if not rows:
            result.source = "empty_cache"
            return result

        result.rows = rows[:_MAX_SYMBOLS]
        result.has_data = True
        return result

    except Exception as exc:  # noqa: BLE001
        _LOG.debug("assistant_discovery fetch failed: %s", exc)
        result.source = "error"
        return result


def serialize_discovery_context(result: DiscoveryResult) -> str:
    """Render a DiscoveryResult as a compact context block for Claude.

    Returns an empty string when there is no data (callers check has_data first).
    """
    if not result.has_data or not result.rows:
        return ""

    lines = [f"=== SCANNER DISCOVERY ({result.mode.upper()} mode) ==="]
    if result.generated_at:
        lines.append(f"generated_at={result.generated_at}")
    lines.append(f"top_{len(result.rows)}_symbols:")
    for row in result.rows:
        lines.append(f"  - {row.symbol}: {row.context}")
    lines.append("")
    return "\n".join(lines)


# ─── internal helpers ────────────────────────────────────────────────────────

def _extract_rows(data: dict) -> list[DiscoveryRow]:
    """Extract discovery rows from a desk cache payload dict."""
    rows: list[DiscoveryRow] = []

    # Path 1: "leaders" array from the opportunity desk batch output.
    leaders = data.get("leaders") or data.get("discovery_rows") or []
    if isinstance(leaders, list):
        for item in leaders:
            if not isinstance(item, dict):
                continue
            sym = str(item.get("symbol") or "").strip().upper()
            if not sym:
                continue
            context = _build_context_line(item)
            rows.append(DiscoveryRow(symbol=sym, context=context))

    # Path 2: "session_activity" symbols from the dashboard context block.
    if not rows:
        activity = data.get("session_activity") or {}
        if isinstance(activity, dict):
            for sym in (activity.get("symbols") or [])[:_MAX_SYMBOLS]:
                sym = str(sym).strip().upper()
                if sym:
                    rows.append(DiscoveryRow(symbol=sym, context="active in today's session"))

    # Path 3: raw "symbols" list as a last resort.
    if not rows:
        for sym in (data.get("symbols") or [])[:_MAX_SYMBOLS]:
            sym = str(sym).strip().upper()
            if sym:
                rows.append(DiscoveryRow(symbol=sym, context="appeared in today's scan"))

    return rows


def _build_context_line(item: dict) -> str:
    """Build a single plain-English context line from a desk leader row dict."""
    parts: list[str] = []

    catalyst = str(item.get("catalyst_category") or item.get("catalyst") or "").strip()
    if catalyst and catalyst.lower() not in ("none", "unknown", ""):
        parts.append(catalyst)

    gap_pct = item.get("gap_pct") or item.get("gap")
    if isinstance(gap_pct, (int, float)) and abs(gap_pct) >= 0.5:
        direction = "up" if gap_pct > 0 else "down"
        parts.append(f"gap {direction} {abs(gap_pct):.1f}%")

    score = item.get("score") or item.get("strength_score")
    if isinstance(score, (int, float)) and score > 0:
        label = "strong" if score >= 75 else "moderate" if score >= 50 else "developing"
        parts.append(f"{label} setup")

    return ", ".join(parts) if parts else "active today"

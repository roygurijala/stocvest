"""
Multi-symbol comparison context for the STOCVEST Assistant.

When the user asks a head-to-head question ("compare NVDA vs AMD", "which is
stronger, NVDA or AMD?"), this builds a compact, factual side-by-side: each
ticker's live price action, STOCVEST's own cached six-layer read (verdict,
alignment, layer leans, and the same "not yet confirmed" caveats the single-
symbol path surfaces), and analyst-consensus target. It deliberately does NOT
rank or pick a winner — the locked prompt's comparison rules keep the assistant
reporting the contrast rather than issuing a "buy X over Y" verdict.

All fetches reuse the single-symbol pipeline (:func:`fetch_assistant_symbol_context`
and :func:`fetch_stocvest_composite_read`) so the comparison stays consistent
with what a single-symbol answer would say. Each symbol is fetched in parallel
and is best-effort: a failed ticker degrades to a "no data" row rather than
breaking the whole comparison.
"""

from __future__ import annotations

import asyncio

from stocvest.api.services.assistant_symbol_context import (
    AssistantSymbolContext,
    fetch_assistant_symbol_context,
    fetch_stocvest_composite_read,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Hard cap on how many tickers we compare in one turn. Three keeps the parallel
# fetch fan-out and the resulting prompt block bounded; beyond that the answer
# stops being a focused comparison.
_MAX_COMPARE = 3

MULTI_SYMBOL_BLOCK_HEADER = "=== MULTI-SYMBOL COMPARISON"


def _analyst_avg_target(ctx: AssistantSymbolContext) -> float | None:
    """Average of the recent standing analyst price targets, or ``None``."""
    targets = []
    for r in (ctx.analyst_ratings or []):
        pt = getattr(r, "price_target", None)
        try:
            if pt is not None and float(pt) > 0:
                targets.append(float(pt))
        except (TypeError, ValueError):
            continue
    if not targets:
        return None
    return sum(targets) / len(targets)


def _current_price(ctx: AssistantSymbolContext) -> float | None:
    """Best available current price from the snapshot (last trade, then close)."""
    snap = ctx.snapshot
    if snap is None:
        return None
    for attr in ("last_trade_price", "day_close"):
        val = getattr(snap, attr, None)
        try:
            if val is not None and float(val) > 0:
                return float(val)
        except (TypeError, ValueError):
            continue
    return None


def _summarize(symbol: str, ctx: AssistantSymbolContext | None, read: dict | None) -> dict:
    """Build a compact, JSON-serializable comparison row for one ticker."""
    if ctx is None or not ctx.has_data:
        return {"symbol": symbol, "has_data": False}

    price = _current_price(ctx)
    snap = ctx.snapshot
    change_pct = None
    if snap is not None and getattr(snap, "change_percent", None) is not None:
        try:
            change_pct = float(snap.change_percent)
        except (TypeError, ValueError):
            change_pct = None

    avg_target = _analyst_avg_target(ctx)
    implied_pct = None
    if avg_target is not None and price:
        implied_pct = (avg_target - price) / price * 100.0

    row: dict[str, object] = {
        "symbol": symbol,
        "has_data": True,
        "price": round(price, 2) if price is not None else None,
        "change_percent": round(change_pct, 2) if change_pct is not None else None,
        "analyst_avg_target": round(avg_target, 2) if avg_target is not None else None,
        "analyst_implied_pct": round(implied_pct, 1) if implied_pct is not None else None,
    }

    if isinstance(read, dict):
        verdict = str(read.get("verdict") or "").strip().lower()
        if verdict in ("bullish", "bearish", "neutral"):
            row["verdict"] = verdict
        align = str(read.get("alignment_label") or "").strip()
        if align:
            row["alignment"] = align
        leans = read.get("leans") if isinstance(read.get("leans"), dict) else None
        if leans:
            row["leans"] = {
                "bullish": int(leans.get("bullish", 0) or 0),
                "bearish": int(leans.get("bearish", 0) or 0),
                "neutral": int(leans.get("neutral", 0) or 0),
                "available": int(leans.get("available", 0) or 0),
            }
        limitations = read.get("limitations")
        if isinstance(limitations, list) and limitations:
            row["limitations"] = [str(x).strip() for x in limitations if str(x).strip()][:3]
        if read.get("stale"):
            row["stale"] = True

    return row


async def fetch_multi_symbol_context(symbols: list[str], mode: str) -> list[dict]:
    """Fetch a comparison bundle for *symbols* (deduped, capped at three).

    Returns one compact summary dict per ticker in input order. Returns an empty
    list when fewer than two distinct tickers survive de-duplication. Never raises
    — a failed ticker becomes a ``{"has_data": False}`` row.
    """
    syms: list[str] = []
    seen: set[str] = set()
    for s in symbols or []:
        u = (s or "").strip().upper()
        if u and u not in seen:
            seen.add(u)
            syms.append(u)
    syms = syms[:_MAX_COMPARE]
    if len(syms) < 2:
        return []

    contexts = await asyncio.gather(
        *[fetch_assistant_symbol_context(s) for s in syms],
        return_exceptions=True,
    )

    out: list[dict] = []
    for sym, ctx in zip(syms, contexts):
        if isinstance(ctx, BaseException):
            _LOG.warning("assistant_multi_ctx: fetch failed for %s: %s", sym, ctx)
            out.append({"symbol": sym, "has_data": False})
            continue
        read = None
        if ctx is not None:
            try:
                read = fetch_stocvest_composite_read(sym, mode)
            except Exception:  # noqa: BLE001 — STOCVEST read is best-effort
                read = None
        out.append(_summarize(sym, ctx, read))
    return out


def _leans_str(leans: dict | None) -> str:
    if not isinstance(leans, dict):
        return ""
    b = int(leans.get("bullish", 0) or 0)
    be = int(leans.get("bearish", 0) or 0)
    n = int(leans.get("neutral", 0) or 0)
    avail = int(leans.get("available", 0) or 0)
    return f"{b} bullish / {be} bearish / {n} neutral (of {avail} contributing layers)"


def serialize_multi_symbol_context(summaries: list[dict]) -> str:
    """Render the comparison rows as a structured side-by-side context block.

    Returns an empty string when fewer than two rows have any usable data — the
    handler then leaves the comparison path silent and the answer falls through to
    the normal single-symbol / general flow.
    """
    rows = [r for r in (summaries or []) if isinstance(r, dict)]
    if len([r for r in rows if r.get("has_data")]) < 2:
        return ""

    syms = ", ".join(str(r.get("symbol") or "?") for r in rows)
    lines: list[str] = [
        f"{MULTI_SYMBOL_BLOCK_HEADER}: {syms} ===",
        "(Report the factual contrast for each. Do NOT rank them or say which to "
        "buy/own — present what STOCVEST and the data show side by side.)",
    ]

    for r in rows:
        sym = str(r.get("symbol") or "?")
        lines.append("")
        lines.append(f"{sym}:")
        if not r.get("has_data"):
            lines.append("  no live data available for this ticker right now")
            continue

        price = r.get("price")
        chg = r.get("change_percent")
        price_str = f"${float(price):.2f}" if isinstance(price, (int, float)) else "n/a"
        chg_str = f"{float(chg):+.2f}%" if isinstance(chg, (int, float)) else "n/a"
        lines.append(f"  price={price_str}  change={chg_str}")

        verdict = str(r.get("verdict") or "").strip()
        if verdict:
            align = str(r.get("alignment") or "").strip()
            align_str = f"  alignment={align}" if align else ""
            lines.append(f"  stocvest_read={verdict}{align_str}")
            leans_str = _leans_str(r.get("leans"))
            if leans_str:
                lines.append(f"  layer_leans={leans_str}")
        else:
            lines.append("  stocvest_read=no recent STOCVEST evaluation cached for this symbol")

        avg_t = r.get("analyst_avg_target")
        if isinstance(avg_t, (int, float)):
            implied = r.get("analyst_implied_pct")
            implied_str = (
                f" (implied {float(implied):+.1f}% vs current)"
                if isinstance(implied, (int, float))
                else ""
            )
            lines.append(f"  analyst_target_avg=${float(avg_t):.2f}{implied_str}")

        limitations = r.get("limitations")
        if isinstance(limitations, list) and limitations:
            lines.append("  not_yet_confirmed (state as caveats): " + "; ".join(limitations))

    lines.append("")  # trailing newline
    return "\n".join(lines)


def multi_symbol_payload(summaries: list[dict]) -> list[dict] | None:
    """Compact per-symbol payload for the API response (UI comparison chips).

    Returns ``None`` when fewer than two rows carry usable data.
    """
    rows = [r for r in (summaries or []) if isinstance(r, dict)]
    if len([r for r in rows if r.get("has_data")]) < 2:
        return None
    out: list[dict] = []
    for r in rows:
        out.append({
            "symbol": str(r.get("symbol") or "?"),
            "price": r.get("price"),
            "change_percent": r.get("change_percent"),
            "verdict": r.get("verdict"),
            "alignment": r.get("alignment"),
        })
    return out

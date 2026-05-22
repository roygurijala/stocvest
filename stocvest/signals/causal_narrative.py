"""
Causal signal narrative — explains WHY layers read the way they do.

Pure functions; no I/O. Attached to swing/day composite responses as ``causal_narrative``.
Does not change gating, scores, or scanner qualification.
"""

from __future__ import annotations

import re
from typing import Any, Literal

LayerPolarity = Literal["supportive", "blocking", "mixed", "neutral", "unavailable"]
LayerRole = Literal["root_cause", "amplifier", "symptom", "gate", "support", "context"]

CAUSAL_LAYER_ORDER: tuple[str, ...] = (
    "macro",
    "geopolitical",
    "internals",
    "sector",
    "news",
    "technical",
)

LAYER_DISPLAY: dict[str, str] = {
    "macro": "Macro",
    "geopolitical": "Geopolitical",
    "internals": "Market Internals",
    "sector": "Sector",
    "news": "News",
    "technical": "Technical",
}

ENVIRONMENT_LAYERS: frozenset[str] = frozenset({"macro", "geopolitical", "internals"})
PARTICIPATION_LAYERS: frozenset[str] = frozenset({"sector", "internals"})
SYMBOL_LAYERS: frozenset[str] = frozenset({"news", "technical"})

GENERIC_REASONING_RE = re.compile(
    r"shows the most recent close-state reading|"
    r"signals align with upside|signals show downside pressure|"
    r"is mixed without strong direction|data is unavailable right now|"
    r"contributes [+-]?\d",
    re.I,
)

_BANNED_WORDS_RE = re.compile(r"\b(buy|sell|consider|watch closely|near miss)\b", re.I)


def _clamp_text(text: str, limit: int = 220) -> str:
    s = " ".join((text or "").split())
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def _setup_bias(signal_summary: str) -> str:
    v = (signal_summary or "").strip().lower()
    if v == "bullish":
        return "bullish"
    if v == "bearish":
        return "bearish"
    return "neutral"


def _verdict_polarity(verdict: str, status: str, bias: str) -> LayerPolarity:
    st = (status or "").strip().lower()
    if st in ("unavailable",):
        return "unavailable"
    v = (verdict or "neutral").strip().lower()
    if bias == "neutral":
        if v in ("bullish", "bearish"):
            return "mixed"
        return "neutral"
    want = "bullish" if bias == "bullish" else "bearish"
    oppose = "bearish" if bias == "bullish" else "bullish"
    if v == want:
        return "supportive"
    if v == oppose:
        return "blocking"
    if v in ("bullish", "bearish"):
        return "mixed"
    return "neutral"


def _substantive_reasoning(text: str) -> bool:
    raw = (text or "").strip()
    if len(raw) < 12:
        return False
    if GENERIC_REASONING_RE.search(raw):
        return False
    return True


def _upstream_for_layer(key: str, blocking_keys: list[str]) -> list[str]:
    if key not in blocking_keys:
        return []
    idx = CAUSAL_LAYER_ORDER.index(key) if key in CAUSAL_LAYER_ORDER else 99
    upstream: list[str] = []
    for other in blocking_keys:
        if other == key:
            continue
        oidx = CAUSAL_LAYER_ORDER.index(other) if other in CAUSAL_LAYER_ORDER else 99
        if oidx < idx and other in ENVIRONMENT_LAYERS.union({"internals", "sector"}):
            upstream.append(other)
    return upstream[:2]


def _role_for_layer(key: str, polarity: LayerPolarity, upstream: list[str]) -> LayerRole:
    if polarity == "supportive":
        return "support"
    if polarity in ("neutral", "unavailable"):
        return "context"
    if key in ENVIRONMENT_LAYERS and not upstream:
        return "root_cause"
    if key == "technical" and upstream:
        return "symptom"
    if key in SYMBOL_LAYERS and upstream:
        return "symptom"
    if upstream:
        return "amplifier"
    return "gate"


def _default_because(key: str, polarity: LayerPolarity, bias: str, upstream: list[str]) -> str:
    name = LAYER_DISPLAY.get(key, key.title())
    up_names = [LAYER_DISPLAY.get(u, u.title()) for u in upstream]
    if polarity == "supportive":
        if key == "technical":
            return "Structure and momentum line up with the setup bias."
        if key == "internals":
            return "Participation breadth supports this direction on the tape."
        if key == "sector":
            return "Sector leadership is confirming versus the broader market."
        if key == "macro":
            return "Macro backdrop is not fighting the setup bias."
        return f"{name} is aligned with the setup bias."
    if polarity == "blocking":
        if upstream:
            chain = " and ".join(up_names)
            if key == "technical":
                return f"Price structure has not cleared while {chain} remain headwinds."
            if key == "sector":
                return f"Sector participation is weak while {chain} keep risk appetite muted."
            if key == "news":
                return f"No catalyst is supporting the bias while {chain} stay unfavorable."
            return f"{name} opposes the setup while {chain} already weigh on alignment."
        if key == "macro":
            return "Macro regime and tape tone are working against this setup direction."
        if key == "internals":
            return "Breadth and participation are not confirming — risk appetite is thin."
        if key == "sector":
            return "Sector is not leading; relative strength does not support the bias."
        if key == "news":
            return "Headline flow offers no catalyst support for this direction."
        if key == "technical":
            return "Trend and structure have not confirmed — continuation gates stay open."
        return f"{name} opposes the setup bias."
    if polarity == "mixed":
        if key == "sector":
            return "Sector participation is mixed — no clear leadership versus SPY."
        if key == "internals":
            return "Internals are split — tape is not giving a clean confirmation."
        return f"{name} is mixed and does not confirm the bias."
    if polarity == "unavailable":
        return "Coverage is unavailable — this layer is not factored into the read."
    return f"{name} is neutral — background context only."


def _headline(key: str, polarity: LayerPolarity, role: LayerRole) -> str:
    name = LAYER_DISPLAY.get(key, key.title())
    if role == "root_cause":
        return f"{name} is the main environmental headwind"
    if role == "amplifier":
        return f"{name} is not confirming while broader conditions stay muted"
    if role == "symptom":
        return f"{name} has not cleared while upstream conditions stay unfavorable"
    if role == "gate":
        return f"{name} is the local gate still open"
    if polarity == "supportive":
        return f"{name} supports the setup bias"
    return f"{name} — background only"


def _build_layer_note(
    row: dict[str, Any],
    *,
    bias: str,
    blocking_keys: list[str],
) -> dict[str, Any] | None:
    key = str(row.get("layer") or "").strip().lower()
    if not key:
        return None
    verdict = str(row.get("verdict") or "neutral")
    status = str(row.get("status") or "")
    polarity = _verdict_polarity(verdict, status, bias)
    if polarity in ("neutral", "unavailable") and not _substantive_reasoning(str(row.get("reasoning") or "")):
        return None
    upstream = _upstream_for_layer(key, blocking_keys)
    role = _role_for_layer(key, polarity, upstream)
    reasoning = str(row.get("reasoning") or "").strip()
    because = (
        _clamp_text(reasoning, 200)
        if _substantive_reasoning(reasoning)
        else _default_because(key, polarity, bias, upstream)
    )
    return {
        "layer": key,
        "name": LAYER_DISPLAY.get(key, key.title()),
        "polarity": polarity,
        "role": role,
        "headline": _headline(key, polarity, role),
        "because": because,
        "caused_by": upstream,
    }


def _build_summary(chain: list[dict[str, Any]], bias: str) -> str:
    if not chain:
        if bias == "neutral":
            return "Layers are mixed — no single direction dominates the read."
        return "No layer is acting as a strong headwind — execution gates still apply separately."
    parts = [c["headline"] for c in chain[:3]]
    if len(chain) == 1:
        return f"{parts[0]}. Other layers are not the primary blocker."
    if len(parts) >= 2:
        return f"{parts[0]}; {parts[1][0].lower() + parts[1][1:] if parts[1] else parts[1]}."
    return ". ".join(parts) + "."


def build_causal_narrative(
    *,
    signal_summary: str,
    layers: list[dict[str, Any]],
    execution_note: str | None = None,
) -> dict[str, Any]:
    """
    Build informational causal narrative for a composite payload.

    ``execution_note`` — optional R/R or readiness gate text (display only).
    """
    bias = _setup_bias(signal_summary)
    layer_by_key = {str(r.get("layer") or "").lower(): r for r in layers if r.get("layer")}

    blocking_keys: list[str] = []
    for key in CAUSAL_LAYER_ORDER:
        row = layer_by_key.get(key)
        if not row:
            continue
        pol = _verdict_polarity(
            str(row.get("verdict") or "neutral"),
            str(row.get("status") or ""),
            bias,
        )
        if pol in ("blocking", "mixed"):
            blocking_keys.append(key)

    layer_notes: dict[str, Any] = {}
    for key in CAUSAL_LAYER_ORDER:
        row = layer_by_key.get(key)
        if not row:
            continue
        note = _build_layer_note(row, bias=bias, blocking_keys=blocking_keys)
        if note:
            layer_notes[key] = note

    chain: list[dict[str, Any]] = []
    for key in CAUSAL_LAYER_ORDER:
        note = layer_notes.get(key)
        if note and note["polarity"] in ("blocking", "mixed"):
            chain.append(note)
    chain = chain[:4]

    summary = _build_summary(chain, bias)
    if execution_note and execution_note.strip():
        ex = _clamp_text(execution_note.strip(), 160)
        if ex.lower() not in summary.lower():
            summary = f"{summary} Execution: {ex}"

    chain_labels = " → ".join(n["name"] for n in chain) if chain else ""

    out = {
        "informational_only": True,
        "setup_bias": bias,
        "summary": _clamp_text(summary, 320),
        "chain": chain,
        "layer_notes": layer_notes,
        "chain_label": chain_labels,
    }
    text_blob = f"{summary} {chain_labels}"
    if _BANNED_WORDS_RE.search(text_blob):
        out["summary"] = "Layer headwinds are documented on the card — see the breakdown below."
    return out

"""
Market context helper for STOCVEST Assistant.

Provides a compact market pulse block (SPY/QQQ/VIX/regime/environment tier)
from the cached dashboard payload so broad questions like "how is the market
doing today?" can be answered with concrete, current context.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from stocvest.data.dashboard_cache import DashboardKeys, read_dashboard_cache
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


@dataclass
class MarketPulseContext:
    source: str = "market_pulse_cache"  # market_pulse_cache | empty_cache | error
    spy_pct: float | None = None
    qqq_pct: float | None = None
    vix_level: float | None = None
    vix_change_pct: float | None = None
    regime: str | None = None
    environment_tier: str | None = None
    generated_at: str | None = None
    has_data: bool = False


def fetch_market_pulse_context() -> MarketPulseContext:
    ctx = MarketPulseContext()
    try:
        envelope = read_dashboard_cache(DashboardKeys.MARKET_PULSE)
        if not isinstance(envelope, dict):
            ctx.source = "empty_cache"
            return ctx
        data = envelope.get("data")
        if not isinstance(data, dict):
            ctx.source = "empty_cache"
            return ctx

        ctx.generated_at = str(envelope.get("generated_at") or envelope.get("computed_at") or "")
        ctx.spy_pct = _as_float(data.get("spy_pct"))
        ctx.qqq_pct = _as_float(data.get("qqq_pct"))
        ctx.vix_level = _as_float(data.get("vix_level"))
        ctx.vix_change_pct = _as_float(data.get("vix_change_pct"))
        ctx.regime = _as_text(data.get("regime"))
        env = data.get("market_environment_day") or data.get("market_environment") or {}
        if isinstance(env, dict):
            ctx.environment_tier = _as_text(env.get("environment_tier"))
        ctx.has_data = any(v is not None for v in (ctx.spy_pct, ctx.qqq_pct, ctx.vix_level)) or bool(ctx.regime)
        return ctx
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("assistant_market_context fetch failed: %s", exc)
        ctx.source = "error"
        return ctx


def serialize_market_pulse_context(ctx: MarketPulseContext) -> str:
    if not ctx.has_data:
        return ""

    lines: list[str] = ["=== MARKET PULSE CONTEXT ==="]
    if ctx.generated_at:
        lines.append(f"generated_at={ctx.generated_at}")
    if ctx.spy_pct is not None:
        lines.append(f"spy_pct={ctx.spy_pct:+.2f}%")
    if ctx.qqq_pct is not None:
        lines.append(f"qqq_pct={ctx.qqq_pct:+.2f}%")
    if ctx.vix_level is not None:
        lines.append(f"vix_level={ctx.vix_level:.2f}")
    if ctx.vix_change_pct is not None:
        lines.append(f"vix_change_pct={ctx.vix_change_pct:+.2f}%")
    if ctx.regime:
        lines.append(f"regime={ctx.regime}")
    if ctx.environment_tier:
        lines.append(f"environment_tier={ctx.environment_tier}")
    lines.append("")
    return "\n".join(lines)


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


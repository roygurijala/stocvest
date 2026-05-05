"""Deterministic swing-composite API fields for signal evidence UI (not investment advice)."""

from __future__ import annotations

import math
from typing import Any

from stocvest.signals.composite_score import CompositeSignal, CompositeVerdict


def _snap_float(snap: dict[str, Any], key: str) -> float | None:
    raw = snap.get(key)
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _sentiment_bucket(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in ("positive", "negative", "neutral"):
        return s
    if "bull" in s or "up" in s or "constructive" in s:
        return "positive"
    if "bear" in s or "down" in s or "risk" in s:
        return "negative"
    return "neutral"


def _intraday_vwap_from_payload_bars(payload: dict[str, Any]) -> float | None:
    bars = payload.get("intraday_bars")
    if not isinstance(bars, list) or not bars:
        return None
    numer = 0.0
    denom = 0.0
    for bar in bars:
        if not isinstance(bar, dict):
            continue
        hi = _snap_float(bar, "high")
        lo = _snap_float(bar, "low")
        close = _snap_float(bar, "close")
        vol = _snap_float(bar, "volume")
        if hi is None or lo is None or close is None or vol is None or vol <= 0:
            continue
        typical = (hi + lo + close) / 3.0
        numer += typical * vol
        denom += vol
    if denom <= 0:
        return None
    return numer / denom


def is_signal_complete(signal: dict[str, Any]) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not signal.get("historical_entry_zone"):
        missing.append("entry_zone")
    if signal.get("reference_stop_level") is None:
        missing.append("stop_level")
    if signal.get("reference_target_1") is None:
        missing.append("target_1")
    if signal.get("vwap") is None:
        missing.append("vwap")
    return (len(missing) == 0, missing)


def build_swing_composite_evidence_fields(
    *,
    composite: CompositeSignal,
    regime: str,
    payload: dict[str, Any],
    confluence: dict[str, Any] | None,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Returns flat dict keys merged into POST /v1/signals/swing/composite JSON body."""
    score = float(composite.score)
    conf = float(composite.confidence)
    mag = abs(score)

    if mag >= 0.35:
        trend_strength = "Strong"
    elif mag >= 0.15:
        trend_strength = "Moderate"
    else:
        trend_strength = "Weak"

    n_conf = int(confluence.get("n_conflicting") or 0) if confluence else 0
    n_conf_yes = int(confluence.get("n_confirming") or 0) if confluence else 0

    if composite.verdict == CompositeVerdict.NEUTRAL:
        trend_direction = "Reversing" if n_conf >= 2 and n_conf_yes >= 1 else "Sideways"
    elif composite.verdict == CompositeVerdict.BULLISH:
        trend_direction = "Uptrend"
    else:
        trend_direction = "Downtrend"

    risk_reward = round(min(3.5, max(1.0, 1.15 + conf * 1.55 + mag * 1.05)), 1)
    rr_warning = risk_reward < 2.0
    if risk_reward < 2.0:
        rr_quality = "low"
    elif risk_reward < 3.0:
        rr_quality = "acceptable"
    elif risk_reward < 4.0:
        rr_quality = "good"
    else:
        rr_quality = "strong"

    reg = (regime or "sideways").strip().lower()
    if reg in ("bull", "bullish"):
        market_regime = "Bullish"
    elif reg in ("bear", "bearish"):
        market_regime = "Bearish"
    else:
        market_regime = "Neutral"

    signal_score = int(round(max(0.0, min(100.0, (score + 1.0) / 2.0 * 100.0))))
    if rr_warning:
        signal_score = int(round(max(0.0, min(100.0, signal_score * 0.8))))

    last = _snap_float(snapshot, "last_trade_price")
    day_lo = _snap_float(snapshot, "day_low")
    day_hi = _snap_float(snapshot, "day_high")
    vwap = _snap_float(snapshot, "day_vwap")
    if vwap is None and bool(payload.get("market_open")):
        vwap = _intraday_vwap_from_payload_bars(payload)

    historical_entry_zone: dict[str, float] | None = None
    if day_lo is not None and day_hi is not None and day_hi > day_lo:
        historical_entry_zone = {"low": round(day_lo, 4), "high": round(day_hi, 4)}
    elif last is not None and last > 0:
        historical_entry_zone = {
            "low": round(last * 0.985, 4),
            "high": round(last * 1.015, 4),
        }

    reference_target_1: float | None = None
    reference_target_2: float | None = None
    reference_stop_level: float | None = None
    if day_hi is not None and day_hi > 0:
        reference_target_1 = round(day_hi * 1.008, 4)
        reference_target_2 = round(day_hi * 1.018, 4)
    elif last is not None and last > 0:
        reference_target_1 = round(last * 1.012, 4)
        reference_target_2 = round(last * 1.024, 4)
    if day_lo is not None and day_lo > 0:
        reference_stop_level = round(day_lo * 0.995, 4)
    elif last is not None and last > 0:
        reference_stop_level = round(last * 0.98, 4)

    catalysts: list[dict[str, str]] = []
    nc = payload.get("news_catalyst")
    if isinstance(nc, dict):
        headline = nc.get("headline") or nc.get("title") or nc.get("text")
        if headline:
            catalysts.append(
                {
                    "text": str(headline).strip()[:240],
                    "sentiment": _sentiment_bucket(str(nc.get("sentiment") or "neutral")),
                }
            )
    extras = payload.get("catalyst_headlines")
    if isinstance(extras, list):
        for item in extras[:3]:
            if isinstance(item, dict) and item.get("text"):
                catalysts.append(
                    {
                        "text": str(item["text"]).strip()[:240],
                        "sentiment": _sentiment_bucket(str(item.get("sentiment") or "neutral")),
                    }
                )
            elif isinstance(item, str) and item.strip():
                catalysts.append({"text": item.strip()[:240], "sentiment": "neutral"})
    catalysts = catalysts[:3]

    risk_factors_detailed: list[dict[str, str]] = []
    geo_verdict = str(payload.get("geopolitical_verdict") or "").strip().lower()
    geo_high = int(payload.get("geo_high_impact_count") or 0)
    if geo_verdict == "bearish" or geo_high > 2:
        risk_factors_detailed.append(
            {
                "label": "Elevated Geopolitical Risk",
                "severity": "high",
                "detail": f"Geo risk high — {geo_high} high-impact events active",
            }
        )
    if bool(payload.get("ema_conflict")):
        risk_factors_detailed.append(
            {
                "label": "EMA Stack Conflict",
                "severity": "medium",
                "detail": "EMA stack does not confirm trend direction",
            }
        )
    if rr_warning:
        risk_factors_detailed.append(
            {
                "label": "Low Risk/Reward",
                "severity": "high",
                "detail": f"R/R {risk_reward:.1f}:1 is below minimum 2:1 threshold",
            }
        )
    alignment_ratio = float(composite.alignment_ratio)
    total_layers = int(round(float(composite.aligned_weight + composite.conflicted_weight)))
    conflicted_count = int(round(float(composite.conflicted_weight)))
    if alignment_ratio < 0.5 and total_layers > 0:
        risk_factors_detailed.append(
            {
                "label": "Conflicted Signal",
                "severity": "high",
                "detail": f"{conflicted_count} of {total_layers} layers conflict with signal direction",
            }
        )
    news_verdict = str(payload.get("news_verdict") or "").strip().lower()
    signal_verdict = str(composite.verdict.value).strip().lower()
    news_score = float(payload.get("news_sentiment_score") or 0.0)
    if news_verdict and news_verdict != signal_verdict and abs(news_score) > 0.5:
        risk_factors_detailed.append(
            {
                "label": "News Sentiment Conflict",
                "severity": "medium",
                "detail": "News sentiment direction opposes signal verdict",
            }
        )
    stale_layers = payload.get("stale_layers")
    if isinstance(stale_layers, list):
        for row in stale_layers[:1]:
            if isinstance(row, dict):
                n = str(row.get("name") or "Unknown layer")
                mins = int(row.get("minutes_ago") or 0)
                risk_factors_detailed.append(
                    {
                        "label": "Stale Layer Data",
                        "severity": "low",
                        "detail": f"{n} data is {mins}m old",
                    }
                )

    risk_factors = [f"{r['label']}: {r['detail']}" for r in risk_factors_detailed]
    if not risk_factors:
        risk_factors = ["No significant risk factors detected"]

    sym = str(payload.get("symbol") or "").strip().upper() or "SYMBOL"
    zone_txt = (
        f"${historical_entry_zone['low']:.2f}–${historical_entry_zone['high']:.2f}"
        if historical_entry_zone
        else "the Historical Entry Zone shown in reference levels"
    )
    vw_txt = f"${vwap:.2f}" if vwap is not None and vwap > 0 else "VWAP from the reference strip"
    signal_parameters = (
        f"Consider observing how {sym} behaves versus {zone_txt} on a closing basis before sizing any follow-up. "
        f"Scale participation down when confirming layers diverge or when price cannot hold {vw_txt}. "
        "Invalidate the constructive read on a decisive close back through the lower bound of the Historical Entry Zone "
        "for this horizon. Signal data only — not investment advice."
    )

    out: dict[str, Any] = {
        "signal_score": signal_score,
        "trend_strength": trend_strength,
        "trend_direction": trend_direction,
        "risk_reward": risk_reward,
        "rr_warning": rr_warning,
        "rr_quality": rr_quality,
        "market_regime": market_regime,
        "catalysts": catalysts,
        "catalyst_headlines": catalysts,
        "risk_factors": risk_factors,
        "risk_factors_detailed": risk_factors_detailed,
        "signal_parameters": signal_parameters,
        "historical_entry_zone": historical_entry_zone,
        "reference_target_1": reference_target_1,
        "reference_target_2": reference_target_2,
        "reference_stop_level": reference_stop_level,
        "alignment_ratio": round(float(composite.alignment_ratio), 4),
        "conflicted_layers": list(composite.conflicted_layers or []),
    }
    if vwap is not None and vwap > 0:
        out["vwap"] = round(vwap, 4)
    is_complete, missing_fields = is_signal_complete(out)
    out["is_complete"] = is_complete
    out["missing_fields"] = missing_fields
    out["status"] = "active" if is_complete else "incomplete"
    return out

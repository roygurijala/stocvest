"""User-tracked trade plans — frozen entry/stop/target snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal

TrackedPlanMode = Literal["swing", "day"]
TrackedPlanBias = Literal["Bullish", "Bearish", "Neutral"]

MAX_TRACKED_PLANS_PER_USER = 24


def _to_decimals(value: Any) -> Any:
    """boto3 rejects Python ``float`` on ``put_item`` — recurse to ``Decimal``."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimals(v) for v in value]
    return value


@dataclass(frozen=True)
class TrackedPlanLevels:
    entry_low: float
    entry_high: float
    stop: float
    target1: float
    target2: float | None
    price_at_commit: float
    risk_reward_at_commit: float | None

    def to_api(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "entryLow": self.entry_low,
            "entryHigh": self.entry_high,
            "stop": self.stop,
            "target1": self.target1,
            "priceAtCommit": self.price_at_commit,
        }
        if self.target2 is not None:
            out["target2"] = self.target2
        if self.risk_reward_at_commit is not None:
            out["riskRewardAtCommit"] = self.risk_reward_at_commit
        return out

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> TrackedPlanLevels:
        return cls(
            entry_low=float(raw["entryLow"]),
            entry_high=float(raw["entryHigh"]),
            stop=float(raw["stop"]),
            target1=float(raw["target1"]),
            target2=float(raw["target2"]) if raw.get("target2") is not None else None,
            price_at_commit=float(raw["priceAtCommit"]),
            risk_reward_at_commit=(
                float(raw["riskRewardAtCommit"]) if raw.get("riskRewardAtCommit") is not None else None
            ),
        )


@dataclass(frozen=True)
class TrackedTradePlan:
    plan_id: str
    user_id: str
    symbol: str
    mode: TrackedPlanMode
    committed_at: datetime
    bias: TrackedPlanBias
    levels: TrackedPlanLevels
    expires_at: str | None = None
    layers_aligned: int | None = None
    layers_total: int | None = None
    entry_zone_quality: str | None = None
    parameter_version: str | None = None
    verdict_line: str | None = None
    desk_min_rr: float | None = None

    def to_dynamo_item(self) -> dict[str, Any]:
        # Same shape as the API payload, but floats coerced to Decimal for boto3.
        return _to_decimals(self.to_api())

    def to_api(self) -> dict[str, Any]:
        out = {
            "id": self.plan_id,
            "symbol": self.symbol,
            "mode": self.mode,
            "committedAt": self.committed_at.astimezone(timezone.utc).isoformat(),
            "bias": self.bias,
            "levels": self.levels.to_api(),
        }
        if self.expires_at:
            out["expiresAt"] = self.expires_at
        if self.layers_aligned is not None:
            out["layersAligned"] = self.layers_aligned
        if self.layers_total is not None:
            out["layersTotal"] = self.layers_total
        if self.entry_zone_quality:
            out["entryZoneQuality"] = self.entry_zone_quality
        if self.parameter_version:
            out["parameterVersion"] = self.parameter_version
        if self.verdict_line:
            out["verdictLine"] = self.verdict_line
        if self.desk_min_rr is not None:
            out["deskMinRr"] = self.desk_min_rr
        return out

    @classmethod
    def from_api(cls, *, user_id: str, payload: dict[str, Any]) -> TrackedTradePlan:
        plan_id = str(payload["id"]).strip()
        symbol = str(payload["symbol"]).strip().upper()
        mode = str(payload["mode"]).strip().lower()
        if mode not in ("swing", "day"):
            raise ValueError("mode must be swing or day.")
        bias = str(payload.get("bias") or "Neutral")
        if bias not in ("Bullish", "Bearish", "Neutral"):
            raise ValueError("bias must be Bullish, Bearish, or Neutral.")
        committed_raw = str(payload["committedAt"])
        committed_at = datetime.fromisoformat(committed_raw.replace("Z", "+00:00"))
        if committed_at.tzinfo is None:
            committed_at = committed_at.replace(tzinfo=timezone.utc)
        levels_raw = payload.get("levels")
        if not isinstance(levels_raw, dict):
            raise ValueError("levels object is required.")
        levels = TrackedPlanLevels.from_api(levels_raw)
        desk_min_rr = payload.get("deskMinRr")
        return cls(
            plan_id=plan_id,
            user_id=user_id,
            symbol=symbol,
            mode=mode,  # type: ignore[arg-type]
            committed_at=committed_at,
            bias=bias,  # type: ignore[arg-type]
            levels=levels,
            expires_at=str(payload["expiresAt"]).strip() if payload.get("expiresAt") else None,
            layers_aligned=int(payload["layersAligned"]) if payload.get("layersAligned") is not None else None,
            layers_total=int(payload["layersTotal"]) if payload.get("layersTotal") is not None else None,
            entry_zone_quality=(
                str(payload["entryZoneQuality"]).strip() if payload.get("entryZoneQuality") else None
            ),
            parameter_version=(
                str(payload["parameterVersion"]).strip() if payload.get("parameterVersion") else None
            ),
            verdict_line=str(payload["verdictLine"]).strip() if payload.get("verdictLine") else None,
            desk_min_rr=float(desk_min_rr) if desk_min_rr is not None else None,
        )

    @classmethod
    def from_dynamo_item(cls, *, user_id: str, item: dict[str, Any]) -> TrackedTradePlan:
        return cls.from_api(user_id=user_id, payload=item)

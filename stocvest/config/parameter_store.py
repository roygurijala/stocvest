"""Load and persist versioned :class:`SignalParameters` (Secrets Manager + optional DynamoDB history)."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import fields, is_dataclass
from typing import Any, TypeVar

import boto3
from botocore.exceptions import ClientError

from stocvest.config.signal_parameters import (
    CompositeParameters,
    MacroParameters,
    NewsParameters,
    SectorParameters,
    SignalParameters,
    TechnicalParameters,
    default_signal_parameters,
    signal_parameters_to_dict,
)
from stocvest.data.parameter_history_store import put_parameter_history_version
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

SECRET_NAME = "stocvest/signal-parameters"

T = TypeVar("T")


def _coerce_dataclass(cls: type[T], raw: Any) -> T:
    if not isinstance(raw, dict):
        return cls()
    allowed = {f.name for f in fields(cls)}
    kwargs = {k: v for k, v in raw.items() if k in allowed}
    for f in fields(cls):
        if f.name not in kwargs:
            continue
        ann = f.type
        if is_dataclass(ann) and isinstance(ann, type):
            kwargs[f.name] = _coerce_dataclass(ann, kwargs[f.name])
    try:
        return cls(**kwargs)  # type: ignore[arg-type]
    except TypeError:
        return cls()


def signal_parameters_from_dict(data: dict[str, Any]) -> SignalParameters:
    """Build :class:`SignalParameters` from a JSON object; unknown keys ignored."""
    base = default_signal_parameters()
    if not isinstance(data, dict):
        return base
    tech = _coerce_dataclass(TechnicalParameters, data.get("technical") or {})
    news = _coerce_dataclass(NewsParameters, data.get("news") or {})
    macro = _coerce_dataclass(MacroParameters, data.get("macro") or {})
    sector = _coerce_dataclass(SectorParameters, data.get("sector") or {})
    comp = _coerce_dataclass(CompositeParameters, data.get("composite") or {})
    return SignalParameters(
        version=str(data.get("version") or base.version),
        created_at=str(data.get("created_at") or ""),
        notes=str(data.get("notes") or ""),
        technical=tech,
        news=news,
        macro=macro,
        sector=sector,
        composite=comp,
    )


def _increment_version(version: str) -> str:
    parts = str(version or "1.0.0").strip().split(".")
    try:
        nums = [int(p) for p in parts[:3]]
    except ValueError:
        nums = [1, 0, 0]
    while len(nums) < 3:
        nums.append(0)
    nums[2] += 1
    return ".".join(str(n) for n in nums[:3])


class ParameterStore:
    """Secrets Manager–backed parameters with in-process TTL cache."""

    _cache: SignalParameters | None = None
    _cache_time: float = 0.0
    CACHE_TTL_SECONDS: int = 300

    @classmethod
    def _region(cls) -> str:
        return get_settings().aws_region

    @classmethod
    def _sync_fetch_secret(cls) -> str | None:
        client = boto3.client("secretsmanager", region_name=cls._region())
        try:
            resp = client.get_secret_value(SecretId=SECRET_NAME)
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code in {"ResourceNotFoundException", "InvalidRequestException"}:
                return None
            raise
        return str(resp.get("SecretString") or "")

    @classmethod
    def get_parameters_sync(cls) -> SignalParameters:
        """Synchronous load for Lambda HTTP handlers (uses TTL cache)."""
        now = time.monotonic()
        if cls._cache is not None and (now - cls._cache_time) < cls.CACHE_TTL_SECONDS:
            return cls._cache

        try:
            raw = cls._sync_fetch_secret()
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    params = signal_parameters_from_dict(data)
                    cls._cache = params
                    cls._cache_time = now
                    return params
        except Exception as exc:
            _LOG.warning("Parameter load failed: %s — using defaults.", exc)

        cls._cache = default_signal_parameters()
        cls._cache_time = now
        return cls._cache

    @classmethod
    async def get_parameters(cls) -> SignalParameters:
        """Async wrapper (uses thread pool for boto3)."""
        return await asyncio.to_thread(cls.get_parameters_sync)

    @classmethod
    def invalidate_cache(cls) -> None:
        cls._cache = None
        cls._cache_time = 0.0

    @classmethod
    def save_parameters_sync(
        cls,
        params: SignalParameters,
        reason: str,
        *,
        signal_count_on_change: int | None = None,
        accuracy_before_change: float | None = None,
        changed_by: str = "stocvest-admin",
    ) -> bool:
        """Persist to Secrets Manager and ParameterHistory table; clears cache."""
        try:
            params.version = _increment_version(params.version)
            from datetime import datetime, timezone

            params.created_at = datetime.now(timezone.utc).isoformat()
            params.notes = reason

            payload = json.dumps(signal_parameters_to_dict(params), separators=(",", ":"))
            client = boto3.client("secretsmanager", region_name=cls._region())
            try:
                client.update_secret(SecretId=SECRET_NAME, SecretString=payload)
            except ClientError as exc:
                code = str((exc.response or {}).get("Error", {}).get("Code", ""))
                if code == "ResourceNotFoundException":
                    client.create_secret(Name=SECRET_NAME, SecretString=payload)
                else:
                    raise

            put_parameter_history_version(
                version=params.version,
                created_at=params.created_at,
                reason=reason,
                parameters_json=payload,
                signal_count_on_change=signal_count_on_change,
                accuracy_before_change=accuracy_before_change,
                changed_by=changed_by,
            )
            cls.invalidate_cache()
            _LOG.info("Parameters updated to v%s: %s", params.version, reason)
            return True
        except Exception as exc:
            _LOG.error("Parameter save failed: %s", exc)
            return False

    @classmethod
    async def save_parameters(
        cls,
        params: SignalParameters,
        reason: str,
        *,
        signal_count_on_change: int | None = None,
        accuracy_before_change: float | None = None,
        changed_by: str = "stocvest-admin",
    ) -> bool:
        return await asyncio.to_thread(
            cls.save_parameters_sync,
            params,
            reason,
            signal_count_on_change=signal_count_on_change,
            accuracy_before_change=accuracy_before_change,
            changed_by=changed_by,
        )

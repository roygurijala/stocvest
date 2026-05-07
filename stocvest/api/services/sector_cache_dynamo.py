"""DynamoDB TTL cache for SectorMapper (optional when ``DYNAMODB_SECTOR_CACHE_TABLE`` is set)."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings


class DynamoSectorCache:
    def __init__(self, table_name: str) -> None:
        self._table_name = (table_name or "").strip()

    @property
    def enabled(self) -> bool:
        return bool(self._table_name)

    async def get_sector_cache(self, symbol: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        sym = symbol.upper().strip()

        def _run() -> dict[str, Any] | None:
            tbl = boto3.resource("dynamodb", region_name=get_settings().aws_region).Table(self._table_name)
            try:
                resp = tbl.get_item(Key={"symbol": sym})
            except ClientError:
                return None
            item = resp.get("Item")
            if not item:
                return None
            try:
                exp = int(item.get("expires_at", 0) or 0)
            except (TypeError, ValueError):
                exp = 0
            if exp and exp < int(time.time()):
                return None
            return {
                "sector_etf": str(item.get("sector_etf") or ""),
                "display_name": item.get("display_name"),
                "sector_name": item.get("sector_name"),
                "sic_code": item.get("sic_code"),
                "resolution_state": item.get("resolution_state"),
            }

        return await asyncio.to_thread(_run)

    async def save_sector_cache(
        self,
        *,
        symbol: str,
        sector_etf: str,
        sector_name: str,
        display_name: str,
        sic_code: str,
        ttl_days: int = 30,
        resolution_state: str = "resolved",
    ) -> None:
        if not self.enabled:
            return
        sym = symbol.upper().strip()
        expires_at = int(time.time()) + max(1, ttl_days) * 86400

        def _run() -> None:
            tbl = boto3.resource("dynamodb", region_name=get_settings().aws_region).Table(self._table_name)
            tbl.put_item(
                Item={
                    "symbol": sym,
                    "sector_etf": sector_etf,
                    "sector_name": sector_name,
                    "display_name": display_name,
                    "sic_code": sic_code,
                    "resolution_state": resolution_state,
                    "expires_at": expires_at,
                }
            )

        await asyncio.to_thread(_run)

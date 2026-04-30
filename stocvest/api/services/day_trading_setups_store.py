"""Persist scanner runs (ranked setups, EOD payloads) to DynamoDB ``DayTradingSetups``."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from stocvest.utils.config import get_settings


# Partition used for scheduled / system-wide scanner output (not yet per-broker account).
SCANNER_SYSTEM_ACCOUNT_ID = "SCANNER_SYSTEM"


class DayTradingSetupsStore(Protocol):
    def put_scan_run(self, *, setup_key: str, scan_type: str, document: dict[str, Any]) -> None: ...


@dataclass
class InMemoryDayTradingSetupsStore:
    rows: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)

    def put_scan_run(self, *, setup_key: str, scan_type: str, document: dict[str, Any]) -> None:
        self.rows[(SCANNER_SYSTEM_ACCOUNT_ID, setup_key)] = {
            "accountId": SCANNER_SYSTEM_ACCOUNT_ID,
            "setupKey": setup_key,
            "scanType": scan_type,
            "document": json.dumps(document, default=str),
        }


@dataclass
class DynamoDayTradingSetupsStore:
    table: Any

    @classmethod
    def from_table_name(cls, *, table_name: str, dynamodb_resource: Any = None) -> "DynamoDayTradingSetupsStore":
        if dynamodb_resource is None:
            import boto3

            settings = get_settings()
            kwargs: dict[str, Any] = {"region_name": settings.aws_region}
            if settings.dynamodb_endpoint_url:
                kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
            dynamodb_resource = boto3.resource("dynamodb", **kwargs)
        return cls(table=dynamodb_resource.Table(table_name))

    def put_scan_run(self, *, setup_key: str, scan_type: str, document: dict[str, Any]) -> None:
        self.table.put_item(
            Item={
                "accountId": SCANNER_SYSTEM_ACCOUNT_ID,
                "setupKey": setup_key,
                "scanType": scan_type,
                "document": json.dumps(document, default=str),
            }
        )


def build_default_day_trading_setups_store() -> DayTradingSetupsStore:
    settings = get_settings()
    if settings.dynamodb_day_trading_setups.strip():
        return DynamoDayTradingSetupsStore.from_table_name(table_name=settings.dynamodb_day_trading_setups.strip())
    if settings.is_development:
        return InMemoryDayTradingSetupsStore()
    raise ValueError(
        "DYNAMODB_DAY_TRADING_SETUPS must be configured in non-development environments."
    )


_SETUP_STORE: DayTradingSetupsStore | None = None


def get_day_trading_setups_store() -> DayTradingSetupsStore:
    global _SETUP_STORE
    if _SETUP_STORE is None:
        _SETUP_STORE = build_default_day_trading_setups_store()
    return _SETUP_STORE


def reset_day_trading_setups_store_for_tests() -> None:
    global _SETUP_STORE
    _SETUP_STORE = None

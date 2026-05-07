"""
One-off DynamoDB SectorCache cleanup: remove stale SPY rows that aren't true broad-market.

Run after deploying updated SIC→sector mappings:
  python scripts/clear_sector_cache_misclassified.py
"""

from __future__ import annotations

import logging

import boto3

from stocvest.signals.sector_mapper import SIC_TO_SECTOR, SectorMapper
from stocvest.utils.config import get_settings

logging.basicConfig(level=logging.INFO)
_LOG = logging.getLogger("clear_sector_cache")


def _is_true_broad_market_sector_cache(item: dict) -> bool:
    sector = str(item.get("sector_name") or "").strip().lower()
    sic_raw = item.get("sic_code")
    sic_code = str(sic_raw).strip() if sic_raw is not None else ""
    sector_from_sic = SIC_TO_SECTOR.get(sic_code, "") if sic_code else ""
    if sector_from_sic and sector_from_sic != "default":
        return False
    return sector == "default" or (not sic_code)


def main() -> None:
    settings = get_settings()
    SectorMapper.clear_memory_cache()
    table_name = settings.dynamodb_sector_cache_table
    if not table_name.strip():
        _LOG.error("DYNAMODB_SECTOR_CACHE_TABLE not configured; exiting.")
        raise SystemExit(1)
    tbl = boto3.resource("dynamodb", region_name=settings.aws_region).Table(table_name)
    scanned = 0
    deleted = 0
    kwargs: dict[str, object] = {}
    while True:
        page = tbl.scan(**kwargs)
        items = page.get("Items") or []
        scanned += len(items)
        for it in items:
            etf = str(it.get("sector_etf") or "").strip().upper()
            if etf != "SPY":
                continue
            if _is_true_broad_market_sector_cache(dict(it)):
                continue
            sym_raw = it.get("symbol")
            symbol = str(sym_raw or "").strip().upper()
            if not symbol:
                continue
            tbl.delete_item(Key={"symbol": symbol})
            deleted += 1
            _LOG.info("cleared stale SPY entry for %s", symbol)
        lek = page.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs = {"ExclusiveStartKey": lek}
    _LOG.info("sector_cache_cleanup_done scanned=%d deleted=%d", scanned, deleted)


if __name__ == "__main__":
    main()

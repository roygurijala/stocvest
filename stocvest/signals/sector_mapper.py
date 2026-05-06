"""Map symbols → sector ETF via SIC (Polygon) with optional DynamoDB TTL cache."""

from __future__ import annotations

from typing import Any, Protocol

from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF
from stocvest.config.signal_parameters import SectorParameters
from stocvest.utils.logging import get_logger

log = get_logger(__name__)


def should_persist_sector_dynamo_item(*, etf: str, sector_name: str, sic_code: str) -> bool:
    """
    Skip Dynamo when SPY is only a guess: no SIC from Polygon → ``default`` bucket.

    Persist SPY when SIC is present but unmapped (explicit broad-market fallback).
    Always persist non-SPY sector ETFs.
    """
    etf_u = (etf or "").strip().upper()
    if etf_u != "SPY":
        return True
    if (sector_name or "").strip().lower() == "default" and not (sic_code or "").strip():
        return False
    return True

# US OSHA SIC manual (SEC filing codes). Stable reference taxonomy.
SIC_TO_SECTOR: dict[str, str] = {
    "3674": "semiconductors",
    "3679": "semiconductors",
    "3672": "hardware",
    "3669": "hardware",
    "3661": "hardware",
    "3577": "hardware",
    "3571": "hardware",
    "7372": "software",
    "7371": "software",
    "7374": "software",
    "7379": "software",
    "7375": "internet",
    "7389": "internet",
    "6022": "banks",
    "6021": "banks",
    "6020": "banks",
    "6035": "banks",
    "6036": "banks",
    "6211": "investment_services",
    "6282": "investment_services",
    "6726": "investment_services",
    "6311": "insurance",
    "6321": "insurance",
    "6331": "insurance",
    "6411": "insurance",
    "6141": "consumer_finance",
    "6153": "consumer_finance",
    "6159": "consumer_finance",
    "2836": "pharma",
    "2835": "pharma",
    "2830": "pharma",
    "2833": "pharma",
    "8731": "biotech",
    "3841": "medical_devices",
    "3826": "medical_devices",
    "3827": "medical_devices",
    "3845": "medical_devices",
    "8000": "health_services",
    "8011": "health_services",
    "8062": "health_services",
    "8099": "health_services",
    "3711": "auto",
    "3714": "auto",
    "5511": "auto",
    "5521": "auto",
    "5812": "restaurants",
    "5311": "retail",
    "5651": "retail",
    "5940": "retail",
    "5961": "retail",
    "5912": "food_beverage",
    "5411": "food_beverage",
    "2000": "food_beverage",
    "2080": "food_beverage",
    "2090": "food_beverage",
    "2100": "food_beverage",
    "1311": "oil_gas",
    "1381": "oil_gas",
    "1382": "oil_gas",
    "2911": "oil_gas",
    "5171": "oil_gas",
    "1321": "oil_gas",
    "3559": "industrials",
    "3537": "industrials",
    "3812": "aerospace_defense",
    "3721": "aerospace_defense",
    "3724": "aerospace_defense",
    "3728": "aerospace_defense",
    "4512": "airlines",
    "4522": "airlines",
    "4213": "transport",
    "4011": "transport",
    "4813": "telecom",
    "4899": "telecom",
    "4833": "media",
    "4832": "media",
    "7812": "media",
    "6500": "real_estate",
    "6512": "real_estate",
    "6552": "real_estate",
    "6798": "real_estate",
    "4911": "utilities",
    "4924": "utilities",
    "4941": "utilities",
    "1040": "mining",
    "2600": "materials",
    "2800": "chemicals",
    "2820": "chemicals",
    "3300": "metals",
    "3310": "metals",
}

ETF_DISPLAY_NAMES: dict[str, str] = {
    "XLK": "Technology",
    "SOXX": "Semiconductors",
    "IGV": "Software",
    "XLF": "Financials",
    "KBE": "Banks",
    "XLV": "Healthcare",
    "XBI": "Biotechnology",
    "XPH": "Pharmaceuticals",
    "IHI": "Medical Devices",
    "XLY": "Consumer Discretionary",
    "XRT": "Retail",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLI": "Industrials",
    "XTN": "Transportation",
    "ITA": "Aerospace & Defense",
    "JETS": "Airlines",
    "XLC": "Communication Services",
    "XLRE": "Real Estate",
    "XLU": "Utilities",
    "XLB": "Materials",
    "XME": "Metals & Mining",
    "SPY": "Broad Market",
}


class SupportsSectorCache(Protocol):
    async def get_sector_cache(self, symbol: str) -> dict[str, Any] | None: ...

    async def save_sector_cache(
        self,
        *,
        symbol: str,
        sector_etf: str,
        sector_name: str,
        display_name: str,
        sic_code: str,
        ttl_days: int = 30,
    ) -> None: ...


class SectorMapper:
    """symbol → (etf_ticker, display_name) using memory → optional cache → Polygon."""

    _memory_cache: dict[str, tuple[str, str, str]] = {}

    @staticmethod
    def _log_sector_resolution(
        *,
        symbol: str,
        etf: str,
        display_name: str,
        source: str,
        sic_code: str | None = None,
        sector_bucket: str | None = None,
        persist_dynamo: bool | None = None,
        extra: str | None = None,
    ) -> None:
        parts = [
            "sector_etf_resolution",
            f"symbol={symbol}",
            f"etf={etf}",
            f"display={display_name}",
            f"source={source}",
        ]
        if sic_code is not None:
            parts.append(f"sic={sic_code if sic_code else '(empty)'}")
        if sector_bucket is not None:
            parts.append(f"bucket={sector_bucket}")
        if persist_dynamo is not None:
            parts.append(f"persist_dynamo={persist_dynamo}")
        if extra:
            parts.append(extra)
        line = " ".join(parts)
        if source == "memory_cache":
            log.debug(line)
        else:
            log.info(line)

    @classmethod
    def clear_memory_cache(cls) -> None:
        cls._memory_cache.clear()

    @classmethod
    async def get_sector_etf(
        cls,
        symbol: str,
        polygon_client: Any,
        sector_cache: SupportsSectorCache | None = None,
        sector_params: SectorParameters | None = None,
    ) -> tuple[str, str, str]:
        """
        Returns ``(sector_etf, display_name, sic_bucket)`` for ETF routing and geo sector weights.
        """
        sym = symbol.upper().strip()
        if not sym:
            cls._log_sector_resolution(
                symbol="(empty)",
                etf="SPY",
                display_name=ETF_DISPLAY_NAMES["SPY"],
                source="empty_symbol_fallback",
            )
            return "SPY", ETF_DISPLAY_NAMES["SPY"], "default"

        if sym in cls._memory_cache:
            etf, dn, bucket = cls._memory_cache[sym]
            cls._log_sector_resolution(
                symbol=sym, etf=etf, display_name=dn, source="memory_cache", sector_bucket=bucket
            )
            return etf, dn, bucket

        if sector_cache is not None:
            try:
                cached = await sector_cache.get_sector_cache(sym)
                if cached and cached.get("sector_etf"):
                    etf = str(cached["sector_etf"])
                    dn = cached.get("display_name") or ETF_DISPLAY_NAMES.get(etf, etf)
                    bucket_cached = str(cached.get("sector_name") or "").strip() or "default"
                    result = (etf, str(dn), bucket_cached)
                    cls._memory_cache[sym] = result
                    sic_cached = str(cached.get("sic_code") or "").strip() or None
                    cls._log_sector_resolution(
                        symbol=sym,
                        etf=etf,
                        display_name=str(dn),
                        source="dynamo_cache",
                        sic_code=sic_cached,
                        sector_bucket=bucket_cached,
                    )
                    return result
            except Exception as exc:
                log.warning("Sector cache read failed symbol=%s err=%s", sym, exc)

        mapping = dict(sector_params.sector_to_etf) if sector_params else dict(DEFAULT_SECTOR_TO_ETF)

        try:
            details = await polygon_client.get_ticker_details(sym)
            if not isinstance(details, dict):
                details = {}
            sic_raw = details.get("sic_code")
            sic_code = str(sic_raw).strip() if sic_raw is not None else ""
            sector_name = SIC_TO_SECTOR.get(sic_code, "default")
            etf = mapping.get(sector_name, mapping.get("default", "SPY"))
            display = str(ETF_DISPLAY_NAMES.get(etf, etf))
            result = (etf, display, sector_name)
            cls._memory_cache[sym] = result

            persist = should_persist_sector_dynamo_item(
                etf=etf, sector_name=sector_name, sic_code=sic_code
            )
            cls._log_sector_resolution(
                symbol=sym,
                etf=etf,
                display_name=display,
                source="polygon_sic",
                sic_code=sic_code,
                sector_bucket=sector_name,
                persist_dynamo=persist,
            )

            if sector_cache is not None and persist:
                try:
                    await sector_cache.save_sector_cache(
                        symbol=sym,
                        sector_etf=etf,
                        sector_name=sector_name,
                        display_name=display,
                        sic_code=sic_code,
                        ttl_days=30,
                    )
                except Exception as exc:
                    log.warning("Sector cache write failed symbol=%s err=%s", sym, exc)

            return result
        except Exception as exc:
            log.warning(
                "sector_etf_resolution symbol=%s etf=SPY source=polygon_error_fallback err=%s",
                sym,
                exc,
            )
            return "SPY", ETF_DISPLAY_NAMES["SPY"], "default"

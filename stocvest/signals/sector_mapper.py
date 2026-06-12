"""Map symbols → sector ETF via SIC (Polygon) with optional DynamoDB TTL cache."""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any, ClassVar, Protocol

from stocvest.api.services.sector_cache_dynamo import DynamoSectorCache
from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF
from stocvest.config.signal_parameters import SectorParameters
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.sector_sic_fallback import (
    SicMappingTier,
    normalize_sic_digits,
    resolve_sector_bucket_from_sic,
)
from stocvest.signals.symbol_sector_overrides import resolve_symbol_sector_override
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

log = get_logger(__name__)


class SectorResolutionState(str, Enum):
    RESOLVED = "resolved"
    PENDING_REFRESH = "pending_cache_refresh"
    UNMAPPED = "unmapped"


def should_persist_sector_dynamo_item(*, etf: str, sector_name: str, sic_code: str) -> bool:
    etf_u = (etf or "").strip().upper()
    if etf_u != "SPY":
        return True
    if (sector_name or "").strip().lower() == "default" and not (sic_code or "").strip():
        return False
    return True


# US OSHA SIC manual (SEC filing codes). Stable reference taxonomy.
SIC_TO_SECTOR: dict[str, str] = {
    "7370": "technology",
    "7371": "software",
    "7372": "software",
    "7373": "technology",
    "7374": "communication_services",
    "7375": "communication_services",
    "7376": "technology",
    "7377": "technology",
    "7378": "technology",
    "7379": "technology",
    "7389": "technology",
    "4812": "communication_services",
    "4813": "communication_services",
    "4833": "communication_services",
    "4841": "communication_services",
    "4899": "communication_services",
    "7812": "communication_services",
    "7922": "communication_services",
    "7929": "communication_services",
    "3674": "semiconductors",
    "3672": "technology",
    "3679": "technology",
    "3669": "hardware",
    "3661": "hardware",
    "3577": "hardware",
    "3571": "hardware",
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
    "1311": "energy",
    "1381": "energy",
    "1382": "energy",
    "2911": "energy",
    "5171": "oil_gas",
    "1321": "oil_gas",
    "3559": "industrials",
    "3537": "industrials",
    # Management / business consulting & related services (e.g. Booz Allen BAH = 8742).
    # Benchmark: XLI vs SPY for broad professional / government-services tilt without SPY–SPY spread.
    "8741": "industrials",
    "8742": "industrials",
    "8743": "industrials",
    "8744": "industrials",
    "8748": "industrials",
    "8711": "industrials",
    "3812": "defense",
    "3760": "defense",
    "3769": "defense",
    "3489": "defense",
    "3721": "aerospace_defense",
    "3724": "aerospace_defense",
    "3728": "aerospace_defense",
    "4512": "airlines",
    "4522": "airlines",
    "4213": "transport",
    "4011": "transport",
    "4832": "media",
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
    "SMH": "Semiconductors",
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
    "ITA": "Aerospace & Defense",
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
        resolution_state: str = "resolved",
    ) -> None: ...


class SectorMapper:
    """symbol → (etf_ticker, display_name, sic_bucket, resolution_state, sic_mapping_tier)."""

    _memory_cache: dict[str, tuple[str, str, str, SectorResolutionState, SicMappingTier]] = {}
    _pending_tasks: ClassVar[dict[str, asyncio.Task]] = {}

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
        resolution_state: str | None = None,
        sic_mapping_tier: str | None = None,
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
        if sic_mapping_tier:
            parts.append(f"sic_mapping_tier={sic_mapping_tier}")
        if persist_dynamo is not None:
            parts.append(f"persist_dynamo={persist_dynamo}")
        if resolution_state:
            parts.append(f"resolution_state={resolution_state}")
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
    def _mapping(cls, sector_params: SectorParameters | None) -> dict[str, str]:
        return dict(sector_params.sector_to_etf) if sector_params else dict(DEFAULT_SECTOR_TO_ETF)

    @classmethod
    def _upgrade_cached_sector_if_sic_now_mapped(
        cls,
        *,
        etf: str,
        display_name: str,
        bucket: str,
        state: SectorResolutionState,
        sic_code: str,
        sector_params: SectorParameters | None,
    ) -> tuple[str, str, str, SectorResolutionState, SicMappingTier] | None:
        """
        Dynamo may still hold SPY + unmapped from before a SIC code was added to SIC_TO_SECTOR.
        If we now have a non-default bucket for that SIC, remap without a Polygon round-trip.
        """
        etf_u = (etf or "").strip().upper()
        sic = normalize_sic_digits(sic_code)
        if not sic or etf_u != "SPY":
            return None
        fresh_bucket, fresh_tier = resolve_sector_bucket_from_sic(sic, SIC_TO_SECTOR)
        if fresh_bucket == "default":
            return None
        mapping = cls._mapping(sector_params)
        new_etf = mapping.get(fresh_bucket, mapping.get("default", "SPY"))
        if (new_etf or "").strip().upper() == "SPY":
            return None
        new_display = str(ETF_DISPLAY_NAMES.get(new_etf, new_etf))
        new_state = SectorResolutionState.RESOLVED
        if new_etf == etf and fresh_bucket == bucket and new_state == state:
            return None
        return (new_etf, new_display, fresh_bucket, new_state, fresh_tier)

    @classmethod
    def _resolution_from_polygon(
        cls,
        *,
        sic_code: str,
        sector_name: str,
        etf: str,
    ) -> SectorResolutionState:
        if sector_name == "default" or not (sic_code or "").strip():
            return SectorResolutionState.UNMAPPED
        return SectorResolutionState.RESOLVED

    @classmethod
    async def _persist_polygon_resolution(
        cls,
        sym: str,
        polygon_client: Any,
        sector_cache: DynamoSectorCache,
        sector_params: SectorParameters | None,
    ) -> None:
        mapping = cls._mapping(sector_params)
        try:
            details = await polygon_client.get_ticker_details(sym)
            if not isinstance(details, dict):
                details = {}
            sic_raw = details.get("sic_code")
            sic_code = normalize_sic_digits(sic_raw)
            sector_name, sic_tier = resolve_sector_bucket_from_sic(sic_code, SIC_TO_SECTOR)
            etf = mapping.get(sector_name, mapping.get("default", "SPY"))
            display = str(ETF_DISPLAY_NAMES.get(etf, etf))
            state = cls._resolution_from_polygon(sic_code=sic_code, sector_name=sector_name, etf=etf)
            cls._memory_cache[sym] = (etf, display, sector_name, state, sic_tier)
            persist = should_persist_sector_dynamo_item(etf=etf, sector_name=sector_name, sic_code=sic_code)
            cls._log_sector_resolution(
                symbol=sym,
                etf=etf,
                display_name=display,
                source="polygon_sic_async",
                sic_code=sic_code,
                sector_bucket=sector_name,
                persist_dynamo=persist,
                resolution_state=state.value,
                sic_mapping_tier=sic_tier.value,
            )
            if persist:
                try:
                    await sector_cache.save_sector_cache(
                        symbol=sym,
                        sector_etf=etf,
                        sector_name=sector_name,
                        display_name=display,
                        sic_code=sic_code,
                        ttl_days=30,
                        resolution_state=state.value,
                    )
                except Exception as exc:
                    log.warning("Sector cache write failed symbol=%s err=%s", sym, exc)
        except Exception as exc:
            log.warning(
                "sector_etf_resolution_async symbol=%s etf=SPY source=polygon_error err=%s",
                sym,
                exc,
            )
            cls._memory_cache[sym] = (
                "SPY",
                ETF_DISPLAY_NAMES["SPY"],
                "default",
                SectorResolutionState.UNMAPPED,
                SicMappingTier.FALLBACK_SPY,
            )

    @classmethod
    async def _schedule_background_resolve(
        cls,
        sym: str,
        sector_cache: DynamoSectorCache,
        sector_params: SectorParameters | None,
    ) -> None:
        if sym in cls._pending_tasks:
            return

        async def _run() -> None:
            settings = get_settings()
            try:
                async with PolygonClient(api_key=settings.polygon_api_key) as pc:
                    await cls._persist_polygon_resolution(sym, pc, sector_cache, sector_params)
            finally:
                cls._pending_tasks.pop(sym, None)

        cls._pending_tasks[sym] = asyncio.create_task(_run())

    @classmethod
    def _apply_symbol_override(
        cls,
        sym: str,
        ticker_ref: Any | None,
        sector_params: SectorParameters | None,
    ) -> tuple[str, str, str, SectorResolutionState, SicMappingTier] | None:
        override = resolve_symbol_sector_override(sym, ticker_ref)
        if not override:
            return None
        bucket, display_label = override
        mapping = cls._mapping(sector_params)
        etf = mapping.get(bucket, mapping.get("default", "SPY"))
        display = str(display_label or ETF_DISPLAY_NAMES.get(etf, etf))
        return (etf, display, bucket, SectorResolutionState.RESOLVED, SicMappingTier.EXACT)

    @classmethod
    async def get_sector_etf(
        cls,
        symbol: str,
        polygon_client: Any,
        sector_cache: SupportsSectorCache | None = None,
        sector_params: SectorParameters | None = None,
        ticker_ref: Any | None = None,
    ) -> tuple[str, str, str, SectorResolutionState, SicMappingTier | None]:
        sym = symbol.upper().strip()
        if not sym:
            cls._log_sector_resolution(
                symbol="(empty)",
                etf="SPY",
                display_name=ETF_DISPLAY_NAMES["SPY"],
                source="empty_symbol_fallback",
                resolution_state=SectorResolutionState.UNMAPPED.value,
                sic_mapping_tier=SicMappingTier.FALLBACK_SPY.value,
            )
            return "SPY", ETF_DISPLAY_NAMES["SPY"], "default", SectorResolutionState.UNMAPPED, SicMappingTier.FALLBACK_SPY

        if sym in cls._memory_cache:
            etf, dn, bucket, st, tier = cls._memory_cache[sym]
            cls._log_sector_resolution(
                symbol=sym,
                etf=etf,
                display_name=dn,
                source="memory_cache",
                sector_bucket=bucket,
                resolution_state=st.value,
                sic_mapping_tier=tier.value,
            )
            return etf, dn, bucket, st, tier

        override_result = cls._apply_symbol_override(sym, ticker_ref, sector_params)
        if override_result is not None:
            etf, dn, bucket, st, tier = override_result
            cls._memory_cache[sym] = override_result
            cls._log_sector_resolution(
                symbol=sym,
                etf=etf,
                display_name=dn,
                source="symbol_override",
                sector_bucket=bucket,
                resolution_state=st.value,
                sic_mapping_tier=tier.value,
            )
            return override_result

        if sector_cache is not None and callable(getattr(sector_cache, "get_sector_cache", None)):
            try:
                cached = await sector_cache.get_sector_cache(sym)
                if cached and cached.get("sector_etf"):
                    etf = str(cached["sector_etf"])
                    dn = cached.get("display_name") or ETF_DISPLAY_NAMES.get(etf, etf)
                    bucket_cached = str(cached.get("sector_name") or "").strip() or "default"
                    rs_raw = str(cached.get("resolution_state") or "").strip()
                    try:
                        st = SectorResolutionState(rs_raw) if rs_raw else SectorResolutionState.RESOLVED
                    except ValueError:
                        st = SectorResolutionState.RESOLVED
                    sic_cached = str(cached.get("sic_code") or "").strip() or None
                    upgraded = cls._upgrade_cached_sector_if_sic_now_mapped(
                        etf=etf,
                        display_name=str(dn),
                        bucket=bucket_cached,
                        state=st,
                        sic_code=sic_cached or "",
                        sector_params=sector_params,
                    )
                    cache_log_source = "dynamo_cache"
                    if upgraded is not None:
                        etf, dn, bucket_cached, st, sic_tier = upgraded
                        cache_log_source = "dynamo_cache_sic_remap"
                        save_fn = getattr(sector_cache, "save_sector_cache", None)
                        if save_fn is not None and sic_cached:
                            try:
                                await save_fn(
                                    symbol=sym,
                                    sector_etf=etf,
                                    sector_name=bucket_cached,
                                    display_name=str(dn),
                                    sic_code=sic_cached,
                                    ttl_days=30,
                                    resolution_state=st.value,
                                )
                            except Exception as exc:
                                log.warning("Sector cache remap write failed symbol=%s err=%s", sym, exc)
                    else:
                        _, sic_tier = resolve_sector_bucket_from_sic(
                            normalize_sic_digits(sic_cached or ""),
                            SIC_TO_SECTOR,
                        )
                    result = (etf, str(dn), bucket_cached, st, sic_tier)
                    cls._memory_cache[sym] = result
                    cls._log_sector_resolution(
                        symbol=sym,
                        etf=etf,
                        display_name=str(dn),
                        source=cache_log_source,
                        sic_code=sic_cached,
                        sector_bucket=bucket_cached,
                        resolution_state=st.value,
                        sic_mapping_tier=sic_tier.value,
                    )
                    return result
            except Exception as exc:
                log.warning("Sector cache read failed symbol=%s err=%s", sym, exc)

        mapping = cls._mapping(sector_params)
        try:
            details = await polygon_client.get_ticker_details(sym)
            if not isinstance(details, dict):
                details = {}
            sic_raw = details.get("sic_code")
            sic_code = normalize_sic_digits(sic_raw)
            sector_name, sic_tier = resolve_sector_bucket_from_sic(sic_code, SIC_TO_SECTOR)
            etf = mapping.get(sector_name, mapping.get("default", "SPY"))
            display = str(ETF_DISPLAY_NAMES.get(etf, etf))
            state = cls._resolution_from_polygon(sic_code=sic_code, sector_name=sector_name, etf=etf)
            result = (etf, display, sector_name, state, sic_tier)
            cls._memory_cache[sym] = result

            persist = should_persist_sector_dynamo_item(etf=etf, sector_name=sector_name, sic_code=sic_code)
            cls._log_sector_resolution(
                symbol=sym,
                etf=etf,
                display_name=display,
                source="polygon_sic",
                sic_code=sic_code,
                sector_bucket=sector_name,
                persist_dynamo=persist,
                resolution_state=state.value,
                sic_mapping_tier=sic_tier.value,
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
                        resolution_state=state.value,
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
            if isinstance(sector_cache, DynamoSectorCache) and sector_cache.enabled:
                await cls._schedule_background_resolve(sym, sector_cache, sector_params)
                cls._log_sector_resolution(
                    symbol=sym,
                    etf="",
                    display_name="Sector resolving…",
                    source="pending_cache_refresh",
                    resolution_state=SectorResolutionState.PENDING_REFRESH.value,
                )
                return "", "Sector resolving…", "default", SectorResolutionState.PENDING_REFRESH, None
            return "SPY", ETF_DISPLAY_NAMES["SPY"], "default", SectorResolutionState.UNMAPPED, SicMappingTier.FALLBACK_SPY

import pytest

from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF
from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.signals.sector_mapper import SIC_TO_SECTOR, SectorMapper
from stocvest.signals.sector_sic_fallback import SicMappingTier


def test_sic_7375_maps_communication_services() -> None:
    assert SIC_TO_SECTOR["7375"] == "communication_services"


def test_default_xlc_for_communication_services() -> None:
    assert DEFAULT_SECTOR_TO_ETF["communication_services"] == "XLC"


def test_default_technology_xlk() -> None:
    assert DEFAULT_SECTOR_TO_ETF["technology"] == "XLK"


def test_pending_sector_cache_chips(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.signals.sector_analyzer import SectorAnalyzer
    from stocvest.signals.sector_mapper import SectorResolutionState

    res = SectorAnalyzer().analyze(
        "T",
        None,
        None,
        default_signal_parameters().sector,
        resolution_state=SectorResolutionState.PENDING_REFRESH,
    )
    assert res.status == "unavailable"
    assert res.score is None
    assert any("not factored" in c.lower() for c in res.chips)
    assert "SPY" not in " ".join(res.chips).upper()


@pytest.mark.asyncio
async def test_bah_sic_8742_resolves_xli(mock_parameter_store: object) -> None:
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState

    SectorMapper.clear_memory_cache()
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "8742"}
    etf, _, bucket, st, tier = await SectorMapper.get_sector_etf("BAH", mock_client, None, mock_parameter_store.sector)
    assert etf == "XLI"
    assert bucket == "industrials"
    assert st == SectorResolutionState.RESOLVED
    assert tier == SicMappingTier.EXACT


@pytest.mark.asyncio
async def test_dynamo_sp_remaps_when_sic_now_in_table(mock_parameter_store: object) -> None:
    """Stale SPY+unmapped cache rows upgrade when SIC maps to a sector ETF (no Polygon call)."""
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState

    SectorMapper.clear_memory_cache()
    mock_cache = AsyncMock()
    mock_cache.get_sector_cache = AsyncMock(
        return_value={
            "sector_etf": "SPY",
            "display_name": "Broad Market",
            "sector_name": "default",
            "sic_code": "8742",
            "resolution_state": "unmapped",
        }
    )
    mock_cache.save_sector_cache = AsyncMock()
    mock_client = AsyncMock()
    etf, _, bucket, st, tier = await SectorMapper.get_sector_etf("BAH", mock_client, mock_cache, mock_parameter_store.sector)
    assert etf == "XLI"
    assert bucket == "industrials"
    assert st == SectorResolutionState.RESOLVED
    assert tier == SicMappingTier.EXACT
    mock_client.get_ticker_details.assert_not_called()
    mock_cache.save_sector_cache.assert_awaited()


@pytest.mark.asyncio
async def test_unmapped_after_polygon_etfs_valid(mock_parameter_store: object) -> None:
    """Non-classifiable SIC (9999) stays SPY + UNMAPPED."""
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState

    SectorMapper.clear_memory_cache()
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "9999"}
    etf, _, bucket, st, tier = await SectorMapper.get_sector_etf("FOO", mock_client, None, mock_parameter_store.sector)
    assert etf == "SPY"
    assert bucket == "default"
    assert st == SectorResolutionState.UNMAPPED
    assert tier == SicMappingTier.FALLBACK_SPY


@pytest.mark.asyncio
async def test_rklb_sic_3760_maps_aerospace_ita(mock_parameter_store: object) -> None:
    """Rocket Lab class SIC 3760 → defense bucket → ITA (Aerospace & Defense display)."""
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import ETF_DISPLAY_NAMES, SectorMapper, SectorResolutionState

    SectorMapper.clear_memory_cache()
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "3760"}
    etf, display, bucket, st, _tier = await SectorMapper.get_sector_etf(
        "RKLB", mock_client, None, mock_parameter_store.sector
    )
    assert etf == "ITA"
    assert display == ETF_DISPLAY_NAMES["ITA"]
    assert bucket == "defense"
    assert st == SectorResolutionState.RESOLVED


@pytest.mark.asyncio
async def test_unknown_sic_coarse_two_digit_maps_industrials(mock_parameter_store: object) -> None:
    """SIC not in exact table but in manufacturing division (20–39) maps to XLI via 2-digit fallback."""
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import SectorMapper, SectorResolutionState

    SectorMapper.clear_memory_cache()
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "2099"}
    etf, _, bucket, st, tier = await SectorMapper.get_sector_etf("ZZZ", mock_client, None, mock_parameter_store.sector)
    assert etf == "XLI"
    assert bucket == "industrials"
    assert st == SectorResolutionState.RESOLVED
    assert tier == SicMappingTier.COARSE

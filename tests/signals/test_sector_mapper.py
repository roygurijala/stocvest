import pytest
from unittest.mock import AsyncMock

from stocvest.signals.sector_mapper import ETF_DISPLAY_NAMES, SIC_TO_SECTOR, SectorMapper


@pytest.fixture(autouse=True)
def clear_mapper_cache():
    SectorMapper.clear_memory_cache()
    yield
    SectorMapper.clear_memory_cache()


def test_sic_3674_maps_to_semiconductors() -> None:
    assert SIC_TO_SECTOR["3674"] == "semiconductors"


def test_sic_7372_maps_to_software() -> None:
    assert SIC_TO_SECTOR["7372"] == "software"


def test_sic_6022_maps_to_banks() -> None:
    assert SIC_TO_SECTOR["6022"] == "banks"


def test_unknown_sic_not_in_dict() -> None:
    assert "9999" not in SIC_TO_SECTOR


@pytest.mark.asyncio
async def test_polygon_lookup_uses_sic(mock_parameter_store) -> None:
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "3674"}
    etf, name = await SectorMapper.get_sector_etf("NVDA", mock_client, None, mock_parameter_store.sector)
    assert etf == "SOXX"
    assert name == ETF_DISPLAY_NAMES["SOXX"]


@pytest.mark.asyncio
async def test_sector_to_etf_from_params(mock_parameter_store) -> None:
    mock_parameter_store.sector.sector_to_etf["semiconductors"] = "TEST_ETF"
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "3674"}
    etf, _ = await SectorMapper.get_sector_etf("NVDA", mock_client, None, mock_parameter_store.sector)
    assert etf == "TEST_ETF"


@pytest.mark.asyncio
async def test_memory_cache_prevents_duplicate() -> None:
    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "3674"}
    await SectorMapper.get_sector_etf("NVDA", mock_client, None, None)
    await SectorMapper.get_sector_etf("NVDA", mock_client, None, None)
    mock_client.get_ticker_details.assert_called_once()


@pytest.mark.asyncio
async def test_dynamo_cache_checked_before_polygon() -> None:
    mock_client = AsyncMock()
    mock_dynamo = AsyncMock()
    mock_dynamo.get_sector_cache.return_value = {"sector_etf": "SOXX", "display_name": "Semiconductors"}
    etf, _ = await SectorMapper.get_sector_etf("NVDA", mock_client, mock_dynamo, None)
    mock_client.get_ticker_details.assert_not_called()
    assert etf == "SOXX"


@pytest.mark.asyncio
async def test_polygon_failure_returns_spy() -> None:
    mock_client = AsyncMock()
    mock_client.get_ticker_details.side_effect = Exception("API error")
    etf, name = await SectorMapper.get_sector_etf("NVDA", mock_client, None, None)
    assert etf == "SPY"
    assert name == ETF_DISPLAY_NAMES["SPY"]

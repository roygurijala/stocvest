import pytest

from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF
from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.signals.sector_mapper import SIC_TO_SECTOR, SectorMapper


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
async def test_unmapped_after_polygon_etfs_valid(mock_parameter_store: object) -> None:
    """Unknown SIC after lookup uses SPY with UNMAPPED state (validated via polygon path mocks)."""
    from unittest.mock import AsyncMock

    from stocvest.signals.sector_mapper import SectorResolutionState

    mock_client = AsyncMock()
    mock_client.get_ticker_details.return_value = {"sic_code": "9999"}
    etf, _, bucket, st = await SectorMapper.get_sector_etf("FOO", mock_client, None, mock_parameter_store.sector)
    assert etf == "SPY"
    assert bucket == "default"
    assert st == SectorResolutionState.UNMAPPED

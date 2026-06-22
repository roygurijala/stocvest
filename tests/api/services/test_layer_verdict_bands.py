"""Unit tests for per-layer verdict bands emitted onto composite layer rows."""

import pytest

from stocvest.api.services.layer_verdict_bands import layer_verdict_band
from stocvest.config.signal_parameters import SignalParameters
from stocvest.signals.geo_analyzer import GEO_BEARISH_THRESHOLD, GEO_BULLISH_THRESHOLD
from stocvest.signals.internals_analyzer import (
    INTERNALS_BEARISH_THRESHOLD,
    INTERNALS_BULLISH_THRESHOLD,
)

pytestmark = pytest.mark.unit


@pytest.fixture()
def params() -> SignalParameters:
    return SignalParameters()


def test_technical_band_follows_mode(params: SignalParameters) -> None:
    day = layer_verdict_band("technical", params, mode="day")
    swing = layer_verdict_band("technical", params, mode="swing")
    assert day == (float(params.technical.bearish_threshold), float(params.technical.bullish_threshold))
    assert swing == (
        float(params.swing_technical.bearish_threshold),
        float(params.swing_technical.bullish_threshold),
    )


def test_sector_and_news_use_their_params(params: SignalParameters) -> None:
    assert layer_verdict_band("sector", params, mode="swing") == (
        float(params.sector.bearish_threshold),
        float(params.sector.bullish_threshold),
    )
    assert layer_verdict_band("news", params, mode="day") == (
        float(params.news.bearish_threshold),
        float(params.news.bullish_threshold),
    )
    assert layer_verdict_band("macro", params, mode="day") == (
        float(params.macro.bearish_threshold),
        float(params.macro.bullish_threshold),
    )


def test_geo_and_internals_use_analyzer_constants(params: SignalParameters) -> None:
    assert layer_verdict_band("geopolitical", params, mode="day") == (
        float(GEO_BEARISH_THRESHOLD),
        float(GEO_BULLISH_THRESHOLD),
    )
    assert layer_verdict_band("internals", params, mode="day") == (
        float(INTERNALS_BEARISH_THRESHOLD),
        float(INTERNALS_BULLISH_THRESHOLD),
    )


def test_band_brackets_a_neutral_score(params: SignalParameters) -> None:
    # APGE's reported scores: sector 62 and geo 58 both sit inside their neutral band.
    sector_lo, sector_hi = layer_verdict_band("sector", params, mode="swing")
    assert sector_lo < 62 < sector_hi
    geo_lo, geo_hi = layer_verdict_band("geopolitical", params, mode="swing")
    assert geo_lo < 58 < geo_hi


def test_unknown_layer_returns_none(params: SignalParameters) -> None:
    assert layer_verdict_band("composite", params, mode="day") is None

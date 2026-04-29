from __future__ import annotations

import pytest


@pytest.mark.unit
def test_stocvest_version() -> None:
    import stocvest

    assert stocvest.__version__ == "0.1.0"


@pytest.mark.unit
def test_public_subpackages_importable() -> None:
    import stocvest.api  # noqa: F401
    import stocvest.brokers  # noqa: F401
    import stocvest.data  # noqa: F401
    import stocvest.indicators  # noqa: F401
    import stocvest.signals  # noqa: F401
    import stocvest.utils  # noqa: F401


@pytest.mark.unit
def test_data_package_exports() -> None:
    from stocvest.data import Bar, PolygonClient, PolygonError, Snapshot

    assert Bar is not None
    assert PolygonClient is not None
    assert PolygonError is not None
    assert Snapshot is not None


@pytest.mark.unit
def test_indicators_package_exports() -> None:
    from stocvest.indicators import ema, sma, vwap

    assert callable(sma)
    assert callable(ema)
    assert callable(vwap)


@pytest.mark.unit
def test_utils_package_exports() -> None:
    from stocvest.utils import get_logger, get_settings

    assert callable(get_settings)
    assert callable(get_logger)


@pytest.mark.unit
def test_brokers_package_exports() -> None:
    from stocvest.brokers import BrokerAdapterFactory, MockBrokerAdapter

    assert BrokerAdapterFactory.create("mock") is not None
    assert isinstance(BrokerAdapterFactory.create("mock"), MockBrokerAdapter)


@pytest.mark.unit
def test_api_package_exports() -> None:
    from stocvest.api import CognitoJwtVerifier, build_request_context, ok, parse_json_body

    assert CognitoJwtVerifier is not None
    assert callable(build_request_context)
    assert callable(parse_json_body)
    assert ok({"status": "ok"})["statusCode"] == 200

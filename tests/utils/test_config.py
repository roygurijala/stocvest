from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from stocvest.utils.config import Settings, get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.unit
def test_lambda_runtime_secret_hydrates_env_in_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "stocvest-development-api-health")
    monkeypatch.setenv("STOCVEST_LAMBDA_RUNTIME_SECRET", "stocvest/lambda-runtime")
    monkeypatch.setenv("BENZINGA_API_KEY", "bz-test")
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("STOCVEST_INTERNAL_ANALYSIS_KEY", raising=False)
    fake = {
        "POLYGON_API_KEY": "poly-from-sm",
        "ANTHROPIC_API_KEY": "anth-from-sm",
        "STOCVEST_INTERNAL_ANALYSIS_KEY": "internal-from-sm",
    }
    mock_sm = MagicMock()
    mock_sm.get_secret_value.return_value = {"SecretString": json.dumps(fake)}
    get_settings.cache_clear()
    with patch("stocvest.utils.config.boto3.client", return_value=mock_sm):
        s = get_settings()
    assert s.polygon_api_key == "poly-from-sm"
    assert s.anthropic_api_key == "anth-from-sm"
    assert s.stocvest_internal_analysis_key == "internal-from-sm"
    mock_sm.get_secret_value.assert_called_once()
    get_settings.cache_clear()
    for k in fake:
        monkeypatch.delenv(k, raising=False)


@pytest.mark.unit
def test_get_settings_loads_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "poly-test-key")
    monkeypatch.setenv("STOCVEST_ENV", "production")
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    get_settings.cache_clear()
    s = get_settings()
    assert s.polygon_api_key == "poly-test-key"
    assert s.is_production is True
    assert s.is_development is False
    assert s.aws_region == "us-west-2"


@pytest.mark.unit
def test_get_settings_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "k1")
    get_settings.cache_clear()
    a = get_settings()
    monkeypatch.setenv("POLYGON_API_KEY", "k2")
    b = get_settings()
    assert a is b
    assert a.polygon_api_key == "k1"


@pytest.mark.unit
def test_settings_missing_polygon_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()


@pytest.mark.unit
def test_settings_anthropic_optional_default_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.anthropic_api_key == ""


@pytest.mark.unit
def test_settings_model_validate() -> None:
    s = Settings.model_validate({"polygon_api_key": "mv"})
    assert s.polygon_api_key == "mv"


@pytest.mark.unit
def test_broker_sandbox_fields_parse_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("STOCVEST_ENABLE_SANDBOX_INTEGRATION", "1")
    monkeypatch.setenv("STOCVEST_IBKR_GATEWAY", "ibkr.binding")
    monkeypatch.setenv("STOCVEST_ETRADE_GATEWAY", "etrade.binding")
    monkeypatch.setenv("ETRADE_CONSUMER_KEY", "ck")
    monkeypatch.setenv("ETRADE_CONSUMER_SECRET", "cs")
    get_settings.cache_clear()
    s = get_settings()
    assert s.sandbox_integration_enabled is True
    assert s.ibkr_gateway_binding == "ibkr.binding"
    assert s.etrade_gateway_binding == "etrade.binding"
    assert s.etrade_consumer_key == "ck"
    assert s.etrade_consumer_secret == "cs"


@pytest.mark.unit
def test_broker_sandbox_fields_default_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.delenv("STOCVEST_ENABLE_SANDBOX_INTEGRATION", raising=False)
    monkeypatch.delenv("STOCVEST_IBKR_GATEWAY", raising=False)
    monkeypatch.delenv("STOCVEST_ETRADE_GATEWAY", raising=False)
    monkeypatch.delenv("ETRADE_CONSUMER_KEY", raising=False)
    monkeypatch.delenv("ETRADE_CONSUMER_SECRET", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.sandbox_integration_enabled is False
    assert s.ibkr_gateway_binding == ""
    assert s.etrade_gateway_binding == ""
    assert s.etrade_consumer_key == ""
    assert s.etrade_consumer_secret == ""


@pytest.mark.unit
def test_cognito_fields_parse_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_pool")
    monkeypatch.setenv("COGNITO_REGION", "us-east-1")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "client-id-123")
    get_settings.cache_clear()
    s = get_settings()
    assert s.cognito_user_pool_id == "us-east-1_pool"
    assert s.cognito_region == "us-east-1"
    assert s.cognito_app_client_id == "client-id-123"


@pytest.mark.unit
def test_cognito_fields_default_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    monkeypatch.delenv("COGNITO_REGION", raising=False)
    monkeypatch.delenv("COGNITO_APP_CLIENT_ID", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.cognito_user_pool_id == ""
    assert s.cognito_region == ""
    assert s.cognito_app_client_id == ""


@pytest.mark.unit
def test_websocket_registry_fields_parse_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("STOCVEST_WS_CONNECTIONS_TABLE", "WsConnections")
    monkeypatch.setenv("STOCVEST_WS_CONNECTION_TTL_SECONDS", "7200")
    get_settings.cache_clear()
    s = get_settings()
    assert s.websocket_connections_table == "WsConnections"
    assert s.websocket_connection_ttl_seconds == 7200


@pytest.mark.unit
def test_websocket_registry_fields_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.delenv("STOCVEST_WS_CONNECTIONS_TABLE", raising=False)
    monkeypatch.delenv("STOCVEST_WS_CONNECTION_TTL_SECONDS", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.websocket_connections_table == ""
    assert s.websocket_connection_ttl_seconds == 86400


@pytest.mark.unit
def test_journal_pdt_tables_parse_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("STOCVEST_TRADE_JOURNAL_TABLE", "TradeJournal")
    monkeypatch.setenv("STOCVEST_PDT_STATE_TABLE", "PDTState")
    get_settings.cache_clear()
    s = get_settings()
    assert s.trade_journal_table == "TradeJournal"
    assert s.pdt_state_table == "PDTState"


@pytest.mark.unit
def test_journal_pdt_tables_default_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.delenv("STOCVEST_TRADE_JOURNAL_TABLE", raising=False)
    monkeypatch.delenv("STOCVEST_PDT_STATE_TABLE", raising=False)
    get_settings.cache_clear()
    s = get_settings()
    assert s.trade_journal_table == ""
    assert s.pdt_state_table == ""

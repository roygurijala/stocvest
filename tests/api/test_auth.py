from __future__ import annotations

import pytest

from stocvest.api.auth import AuthError, get_cognito_auth_config
from stocvest.utils.config import get_settings


def test_get_cognito_auth_config_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COGNITO_REGION", "us-east-1")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-east-1_abc")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "client-123")
    get_settings.cache_clear()
    cfg = get_cognito_auth_config()
    assert cfg.region == "us-east-1"
    assert cfg.user_pool_id == "us-east-1_abc"
    assert cfg.app_client_id == "client-123"
    assert cfg.issuer.endswith("/us-east-1_abc")


def test_get_cognito_auth_config_requires_required_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
    monkeypatch.delenv("COGNITO_APP_CLIENT_ID", raising=False)
    get_settings.cache_clear()
    with pytest.raises(AuthError):
        get_cognito_auth_config()


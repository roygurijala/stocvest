from __future__ import annotations

import pytest
import respx
from httpx import Response

from stocvest.brokers.etrade_oauth import ETradeOAuthClient
from stocvest.brokers.exceptions import BrokerAuthError, BrokerRateLimitError


@pytest.mark.unit
@respx.mock
def test_request_token_and_authorize_url() -> None:
    client = ETradeOAuthClient(consumer_key="ck", consumer_secret="cs", sandbox=True)
    respx.post("https://apisb.etrade.com/oauth/request_token").mock(
        return_value=Response(200, text="oauth_token=req123&oauth_token_secret=sec123")
    )
    temp = client.request_token(callback_url="oob")
    assert temp.token == "req123"
    url = client.build_authorize_url(temp.token)
    assert "apisb.etrade.com/e/t/etws/authorize" in url
    assert "token=req123" in url
    client.close()


@pytest.mark.unit
@respx.mock
def test_exchange_access_token() -> None:
    client = ETradeOAuthClient(consumer_key="ck", consumer_secret="cs", sandbox=True)
    respx.post("https://apisb.etrade.com/oauth/access_token").mock(
        return_value=Response(200, text="oauth_token=acc1&oauth_token_secret=accsec1")
    )
    acc = client.exchange_access_token(
        request_token="req1",
        request_token_secret="reqsec",
        verifier="ver1",
    )
    assert acc.token == "acc1"
    assert acc.token_secret == "accsec1"
    client.close()


@pytest.mark.unit
@respx.mock
def test_renew_and_revoke() -> None:
    client = ETradeOAuthClient(consumer_key="ck", consumer_secret="cs", sandbox=True)
    respx.post("https://apisb.etrade.com/oauth/renew_access_token").mock(
        return_value=Response(200, text="ok=1")
    )
    respx.post("https://apisb.etrade.com/oauth/revoke_access_token").mock(
        return_value=Response(200, text="ok=1")
    )
    client.renew_access_token(access_token="a", access_token_secret="s")
    client.revoke_access_token(access_token="a", access_token_secret="s")
    client.close()


@pytest.mark.unit
@respx.mock
def test_oauth_error_mapping() -> None:
    client = ETradeOAuthClient(consumer_key="ck", consumer_secret="cs", sandbox=True)
    respx.post("https://apisb.etrade.com/oauth/request_token").mock(return_value=Response(401))
    with pytest.raises(BrokerAuthError):
        client.request_token()

    respx.post("https://apisb.etrade.com/oauth/access_token").mock(return_value=Response(429))
    with pytest.raises(BrokerRateLimitError):
        client.exchange_access_token(
            request_token="req1",
            request_token_secret="reqsec",
            verifier="ver1",
        )
    client.close()


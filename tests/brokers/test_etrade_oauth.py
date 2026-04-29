from __future__ import annotations

import os

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


@pytest.mark.unit
def test_oauth_hmac_sha1_signature_matches_rfc_example() -> None:
    """
    Verifies signature math against OAuth 1.0 RFC example values.
    """
    client = ETradeOAuthClient(consumer_key="dpf43f3p2l4k3l03", consumer_secret="kd94hf93k423kf44", sandbox=True)
    oauth_params = {
        "oauth_consumer_key": "dpf43f3p2l4k3l03",
        "oauth_token": "nnch734d00sl2jdk",
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": "1191242096",
        "oauth_nonce": "kllo9940pd9333jh",
        "oauth_version": "1.0",
    }
    signature = client._oauth_hmac_sha1_signature(
        method="GET",
        url="http://photos.example.net/photos",
        oauth_params=oauth_params,
        request_params={"file": "vacation.jpg", "size": "original"},
        token_secret="pfkkdhi9sl3r4s00",
    )
    assert signature == "tR3+Ty81lMeYAr/Fid0kMTYa/WM="
    client.close()


@pytest.mark.integration
def test_etrade_oauth_request_token_live_sandbox() -> None:
    if os.getenv("STOCVEST_ENABLE_SANDBOX_INTEGRATION") != "1":
        pytest.skip("Set STOCVEST_ENABLE_SANDBOX_INTEGRATION=1 to run sandbox tests.")
    consumer_key = os.getenv("ETRADE_CONSUMER_KEY", "").strip()
    consumer_secret = os.getenv("ETRADE_CONSUMER_SECRET", "").strip()
    if not consumer_key or not consumer_secret:
        pytest.skip("ETRADE_CONSUMER_KEY/ETRADE_CONSUMER_SECRET are required.")

    client = ETradeOAuthClient(consumer_key=consumer_key, consumer_secret=consumer_secret, sandbox=True)
    try:
        temp = client.request_token(callback_url="oob")
        assert temp.token
        assert temp.token_secret
    finally:
        client.close()


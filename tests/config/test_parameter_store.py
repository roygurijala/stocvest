from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.config.parameter_store import ParameterStore, signal_parameters_from_dict
from stocvest.config.signal_parameters import SignalParameters, default_signal_parameters


@pytest.fixture(autouse=True)
def _clear_param_cache() -> None:
    ParameterStore.invalidate_cache()
    yield
    ParameterStore.invalidate_cache()


def test_default_parameters_loaded_when_secret_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ParameterStore, "_sync_fetch_secret", lambda: None)
    p = ParameterStore.get_parameters_sync()
    assert isinstance(p, SignalParameters)
    assert p.version == "1.0.0"


def test_parameters_cached_5_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def _fetch() -> str | None:
        calls.append(1)
        return '{"version": "2.0.0", "created_at": "", "notes": "", "technical": {}, "news": {}, "macro": {}, "sector": {}, "composite": {}}'

    monkeypatch.setattr(ParameterStore, "_sync_fetch_secret", _fetch)
    base = 1000.0
    monkeypatch.setattr("stocvest.config.parameter_store.time.monotonic", lambda: base)
    a = ParameterStore.get_parameters_sync()
    b = ParameterStore.get_parameters_sync()
    assert a.version == "2.0.0"
    assert b.version == "2.0.0"
    assert len(calls) == 1


def test_parameters_reloaded_after_cache_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def _fetch() -> str | None:
        calls.append(1)
        return '{"version": "2.0.0", "created_at": "", "notes": "", "technical": {}, "news": {}, "macro": {}, "sector": {}, "composite": {}}'

    monkeypatch.setattr(ParameterStore, "_sync_fetch_secret", _fetch)
    t = {"v": 1000.0}

    def mono() -> float:
        return t["v"]

    monkeypatch.setattr("stocvest.config.parameter_store.time.monotonic", mono)
    ParameterStore.get_parameters_sync()
    t["v"] = 1000.0 + ParameterStore.CACHE_TTL_SECONDS + 1.0
    ParameterStore.get_parameters_sync()
    assert len(calls) == 2


def test_parameter_weights_sum_to_one() -> None:
    p = default_signal_parameters()
    tw = (
        p.technical.vwap_weight
        + p.technical.orb_weight
        + p.technical.ema_weight
        + p.technical.rsi_weight
        + p.technical.volume_weight
    )
    assert abs(tw - 1.0) < 1e-9
    cw = (
        p.composite.technical_weight
        + p.composite.news_weight
        + p.composite.macro_weight
        + p.composite.sector_weight
        + p.composite.geopolitical_weight
        + p.composite.internals_weight
    )
    assert abs(cw - 1.0) < 1e-9


def test_save_creates_version_history(monkeypatch: pytest.MonkeyPatch) -> None:
    history: list[dict] = []

    def capture(**kw: object) -> None:
        history.append(dict(kw))  # type: ignore[arg-type]

    monkeypatch.setattr("stocvest.config.parameter_store.put_parameter_history_version", capture)

    fake = MagicMock()
    fake.update_secret = MagicMock(return_value={})

    def client_factory(*a: object, **kw: object) -> MagicMock:
        return fake

    monkeypatch.setattr("stocvest.config.parameter_store.boto3.client", client_factory)

    params = default_signal_parameters()
    params.version = "1.0.0"
    ok = ParameterStore.save_parameters_sync(params, "test save", signal_count_on_change=10, accuracy_before_change=55.5)
    assert ok is True
    fake.update_secret.assert_called_once()
    assert len(history) == 1
    assert history[0]["version"] != ""


def test_signal_parameters_from_dict_roundtrip() -> None:
    p = default_signal_parameters()
    from stocvest.config.signal_parameters import signal_parameters_to_dict

    d = signal_parameters_to_dict(p)
    q = signal_parameters_from_dict(d)
    assert q.composite.technical_weight == p.composite.technical_weight

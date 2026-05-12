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


# ---------------------------------------------------------------------------
# B30 Phase 3 — per-mode composite override blocks parsing (Suggestion 4 audit)
# ---------------------------------------------------------------------------
#
# These tests pin the Secrets Manager JSON contract for the new
# `swing_composite` and `day_composite` keys. The load-bearing guarantee is
# **back-compat**: any existing secret payload (which has no per-mode blocks)
# must parse with `swing_composite == day_composite == None`, so the resolver
# in `stocvest.signals.composite_score` falls back to the shared `composite`
# block and production behavior is unchanged.


def test_signal_parameters_from_dict_legacy_secret_has_no_per_mode_blocks() -> None:
    """Existing Secrets Manager JSON (no swing_composite / day_composite keys) parses cleanly."""
    legacy_json = {
        "version": "1.0.0",
        "created_at": "",
        "notes": "",
        "technical": {},
        "news": {},
        "macro": {},
        "sector": {},
        "composite": {},
    }
    p = signal_parameters_from_dict(legacy_json)
    assert p.swing_composite is None
    assert p.day_composite is None
    # Shared block parsed normally.
    assert p.composite.technical_weight == default_signal_parameters().composite.technical_weight


def test_signal_parameters_from_dict_with_swing_composite_block() -> None:
    """New JSON with a `swing_composite` key parses into a CompositeParameters instance."""
    json_data = {
        "composite": {},
        "swing_composite": {
            "technical_weight": 0.28,
            "news_weight": 0.15,
            "macro_weight": 0.20,
            "sector_weight": 0.18,
            "geopolitical_weight": 0.12,
            "internals_weight": 0.07,
            "bullish_threshold": 0.25,
            "bearish_threshold": -0.25,
        },
    }
    p = signal_parameters_from_dict(json_data)
    assert p.swing_composite is not None
    assert p.swing_composite.technical_weight == pytest.approx(0.28)
    assert p.swing_composite.news_weight == pytest.approx(0.15)
    assert p.swing_composite.macro_weight == pytest.approx(0.20)
    assert p.swing_composite.bullish_threshold == pytest.approx(0.25)
    # day_composite remains None.
    assert p.day_composite is None


def test_signal_parameters_from_dict_with_day_composite_block() -> None:
    """New JSON with a `day_composite` key parses into a CompositeParameters instance."""
    json_data = {
        "composite": {},
        "day_composite": {
            "technical_weight": 0.32,
            "news_weight": 0.25,
            "macro_weight": 0.10,
            "sector_weight": 0.12,
            "geopolitical_weight": 0.08,
            "internals_weight": 0.13,
        },
    }
    p = signal_parameters_from_dict(json_data)
    assert p.day_composite is not None
    assert p.day_composite.technical_weight == pytest.approx(0.32)
    assert p.day_composite.news_weight == pytest.approx(0.25)
    assert p.day_composite.internals_weight == pytest.approx(0.13)
    # swing_composite remains None.
    assert p.swing_composite is None


def test_signal_parameters_from_dict_with_both_per_mode_blocks() -> None:
    """Both per-mode blocks can coexist and parse independently."""
    json_data = {
        "composite": {},
        "swing_composite": {"technical_weight": 0.28, "news_weight": 0.15, "macro_weight": 0.20,
                            "sector_weight": 0.18, "geopolitical_weight": 0.12, "internals_weight": 0.07},
        "day_composite": {"technical_weight": 0.32, "news_weight": 0.25, "macro_weight": 0.10,
                          "sector_weight": 0.12, "geopolitical_weight": 0.08, "internals_weight": 0.13},
    }
    p = signal_parameters_from_dict(json_data)
    assert p.swing_composite is not None and p.day_composite is not None
    assert p.swing_composite.technical_weight == pytest.approx(0.28)
    assert p.day_composite.technical_weight == pytest.approx(0.32)


def test_signal_parameters_from_dict_per_mode_null_explicit() -> None:
    """Explicit null in JSON for a per-mode block parses as None (defensive)."""
    json_data = {
        "composite": {},
        "swing_composite": None,
        "day_composite": None,
    }
    p = signal_parameters_from_dict(json_data)
    assert p.swing_composite is None
    assert p.day_composite is None


def test_signal_parameters_from_dict_per_mode_unknown_keys_ignored() -> None:
    """Unknown keys inside a per-mode block are ignored (forward-compat)."""
    json_data = {
        "composite": {},
        "swing_composite": {
            "technical_weight": 0.28,
            "future_field_we_dont_know": 999,
        },
    }
    p = signal_parameters_from_dict(json_data)
    assert p.swing_composite is not None
    assert p.swing_composite.technical_weight == pytest.approx(0.28)
    # Default values used for unspecified known fields.
    assert p.swing_composite.news_weight == pytest.approx(default_signal_parameters().composite.news_weight)


def test_signal_parameters_to_dict_round_trip_with_per_mode_blocks() -> None:
    """Round-trip: serialize with overrides → parse back → same values."""
    from dataclasses import replace

    from stocvest.config.signal_parameters import CompositeParameters, signal_parameters_to_dict

    base = default_signal_parameters()
    swing_override = CompositeParameters(
        technical_weight=0.28, news_weight=0.15, macro_weight=0.20,
        sector_weight=0.18, geopolitical_weight=0.12, internals_weight=0.07,
    )
    day_override = CompositeParameters(
        technical_weight=0.32, news_weight=0.25, macro_weight=0.10,
        sector_weight=0.12, geopolitical_weight=0.08, internals_weight=0.13,
    )
    custom = replace(base, swing_composite=swing_override, day_composite=day_override)

    serialized = signal_parameters_to_dict(custom)
    assert "swing_composite" in serialized
    assert "day_composite" in serialized

    restored = signal_parameters_from_dict(serialized)
    assert restored.swing_composite is not None
    assert restored.day_composite is not None
    assert restored.swing_composite.technical_weight == pytest.approx(0.28)
    assert restored.day_composite.technical_weight == pytest.approx(0.32)

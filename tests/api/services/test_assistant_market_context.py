from stocvest.api.services.assistant_market_context import (
    fetch_market_pulse_context,
    serialize_market_pulse_context,
)


def test_fetch_market_pulse_context_reads_cached_payload(monkeypatch) -> None:
    def _fake_read(_key: str):
        return {
            "generated_at": "2026-06-03T10:00:00Z",
            "data": {
                "spy_pct": 0.52,
                "qqq_pct": 0.71,
                "vix_level": 17.4,
                "vix_change_pct": -1.3,
                "regime": "Risk-on",
                "market_environment_day": {"environment_tier": "normal"},
            },
        }

    monkeypatch.setattr(
        "stocvest.api.services.assistant_market_context.read_dashboard_cache",
        _fake_read,
    )

    ctx = fetch_market_pulse_context()
    assert ctx.has_data is True
    assert ctx.regime == "Risk-on"
    assert ctx.environment_tier == "normal"
    assert ctx.spy_pct == 0.52


def test_serialize_market_pulse_context_contains_expected_lines() -> None:
    class _Ctx:
        has_data = True
        generated_at = "2026-06-03T10:00:00Z"
        spy_pct = 0.5
        qqq_pct = 0.7
        vix_level = 18.2
        vix_change_pct = -0.4
        regime = "Risk-on"
        environment_tier = "normal"

    body = serialize_market_pulse_context(_Ctx())  # type: ignore[arg-type]
    assert "=== MARKET PULSE CONTEXT ===" in body
    assert "spy_pct=+0.50%" in body
    assert "qqq_pct=+0.70%" in body
    assert "regime=Risk-on" in body


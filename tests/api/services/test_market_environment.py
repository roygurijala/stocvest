from __future__ import annotations

from stocvest.api.services.market_environment import (
    ENVIRONMENT_POLICY_VERSION,
    apply_tier_hysteresis,
    build_market_environment_policy,
    resolve_environment_tier,
    resolve_environment_tier_raw,
    suppress_reference_target_2,
    target_policy_from_environment,
    vix_change_5d_pct_from_observations,
)


def test_tier_normal() -> None:
    assert resolve_environment_tier(vix_level=18.0) == "normal"


def test_tier_elevated() -> None:
    assert resolve_environment_tier(vix_level=24.0) == "elevated"


def test_tier_stressed_by_level() -> None:
    assert resolve_environment_tier(vix_level=29.0) == "stressed"


def test_tier_crisis() -> None:
    assert resolve_environment_tier(vix_level=33.0) == "crisis"


def test_tier_spike_overlay() -> None:
    assert resolve_environment_tier(vix_level=23.0, vix_change_pct=11.0) == "stressed"


def test_tier_5d_spike_overlay() -> None:
    assert resolve_environment_tier(vix_level=21.0, vix_change_5d_pct=13.0) == "stressed"


def test_vix_change_5d_pct_from_observations() -> None:
    obs = [("2026-05-01", 18.0), ("2026-05-08", 20.5)]
    assert vix_change_5d_pct_from_observations(obs) == round(((20.5 - 18.0) / 18.0) * 100.0, 2)
    assert vix_change_5d_pct_from_observations(obs, current_level=21.0) == round(((21.0 - 18.0) / 18.0) * 100.0, 2)


def test_hysteresis_holds_crisis_until_exit_band() -> None:
    raw = resolve_environment_tier_raw(vix_level=31.0)
    assert raw == "stressed"
    held = apply_tier_hysteresis("crisis", raw, vix_level=31.0)
    assert held == "crisis"


def test_hysteresis_one_step_improvement() -> None:
    raw = resolve_environment_tier_raw(vix_level=18.0)
    assert raw == "normal"
    step = apply_tier_hysteresis("stressed", raw, vix_level=18.0)
    assert step == "elevated"


def test_hysteresis_worsening_immediate() -> None:
    tier = resolve_environment_tier(vix_level=33.0, previous_tier="normal")
    assert tier == "crisis"


def test_policy_v2_fields() -> None:
    pol = build_market_environment_policy(
        mode="swing",
        vix_level=26.0,
        vix_change_pct=2.0,
        vix_change_5d_pct=8.0,
        previous_environment_tier="stressed",
    )
    assert pol["policy_version"] == ENVIRONMENT_POLICY_VERSION
    assert pol["environment_tier_raw"] == "elevated"
    assert pol["vix_change_5d_pct"] == 8.0
    assert "hysteresis_applied" in pol


def test_swing_crisis_blocks_new_swing() -> None:
    pol = build_market_environment_policy(mode="swing", vix_level=32.5, vix_change_pct=2.0)
    assert pol["policy_version"] == ENVIRONMENT_POLICY_VERSION
    assert pol["environment_tier"] == "crisis"
    assert pol["new_swing_allowed"] is False
    assert pol["new_day_allowed"] is False
    assert pol["min_rr_swing"] == 3.0
    assert pol["target_policy"] == "t1_only"
    assert suppress_reference_target_2(target_policy_from_environment(pol))


def test_elevated_swing_requires_3_to_1() -> None:
    pol = build_market_environment_policy(mode="swing", vix_level=22.0)
    assert pol["environment_tier"] == "elevated"
    assert pol["new_swing_allowed"] is True
    assert pol["min_rr_swing"] == 3.0
    assert pol["min_rr"] == 3.0


def test_normal_day_min_rr() -> None:
    pol = build_market_environment_policy(mode="day", vix_level=17.0)
    assert pol["min_rr_day"] == 1.3
    assert pol["min_rr"] == 1.3
    assert pol["target_policy"] == "t1_and_t2"

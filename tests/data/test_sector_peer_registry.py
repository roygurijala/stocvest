"""Tests for static laggard peer registry (Chunk 2 — no external I/O)."""

from __future__ import annotations

import pytest

from stocvest.data.sector_peer_registry import (
    ADR_SYMBOLS,
    PeerGroupType,
    get_all_peer_groups,
    get_all_registry_symbols,
    get_group_by_trigger_entity,
    get_lag_threshold,
    get_peer_group,
    get_pre_ipo_proxy_groups,
    is_etf,
    registry_group_keys,
)


def test_get_peer_group_nvda_returns_semis() -> None:
    g = get_peer_group("NVDA")
    assert g is not None
    assert g.registry_key == "semiconductors"
    assert g.group_type == PeerGroupType.SECTOR


def test_get_peer_group_unknown_returns_none() -> None:
    assert get_peer_group("ZZZZZ") is None
    assert get_peer_group("") is None


def test_get_peer_group_case_insensitive() -> None:
    g = get_peer_group("nvda")
    assert g is not None
    assert g.registry_key == "semiconductors"


def test_get_all_peer_groups_nvda_multiple_groups() -> None:
    groups = get_all_peer_groups("NVDA")
    keys = {g.registry_key for g in groups}
    assert "semiconductors" in keys
    assert "mega_cap_tech" in keys
    assert "ai_theme" in keys
    assert "rate_sensitive_growth" in keys
    assert len(groups) >= 4
    # Most specific first
    assert groups[0].group_type == PeerGroupType.SECTOR
    assert groups[0].registry_key == "semiconductors"


def test_sector_groups_require_etf_confirmation() -> None:
    for key in registry_group_keys():
        from stocvest.data.sector_peer_registry import _PEER_GROUPS

        g = _PEER_GROUPS[key]
        if g.group_type == PeerGroupType.SECTOR:
            assert g.requires_etf_confirmation is True, key


def test_non_sector_groups_no_etf_required() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    for g in _PEER_GROUPS.values():
        if g.group_type != PeerGroupType.SECTOR:
            assert g.requires_etf_confirmation is False, g.registry_key


def test_pre_ipo_proxy_no_etf() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    g = _PEER_GROUPS["openai_ecosystem"]
    assert g.primary_etf is None
    assert g.group_type == PeerGroupType.PRE_IPO_PROXY


def test_get_group_by_trigger_entity_spacex() -> None:
    g = get_group_by_trigger_entity("spacex")
    assert g is not None
    assert g.registry_key == "spacex_adjacent"
    assert g.trigger_entity == "SpaceX"


def test_group_types_assigned_correctly() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    assert _PEER_GROUPS["semiconductors"].group_type == PeerGroupType.SECTOR
    assert _PEER_GROUPS["ai_theme"].group_type == PeerGroupType.THEME
    assert _PEER_GROUPS["openai_ecosystem"].group_type == PeerGroupType.PRE_IPO_PROXY


def test_adr_lag_threshold_higher() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    semis = _PEER_GROUPS["semiconductors"]
    assert get_lag_threshold(semis, "TSM") == 2.0
    assert get_lag_threshold(semis, "NVDA") == 1.5
    assert ADR_SYMBOLS == frozenset({"TSM", "ASML"})


def test_all_registry_symbols_no_duplicates() -> None:
    syms = get_all_registry_symbols()
    assert len(syms) == len(set(syms))
    assert len(syms) >= 80


def test_etfs_not_in_peers_list() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    for g in _PEER_GROUPS.values():
        if not g.primary_etf:
            continue
        peer_set = {p.upper() for p in g.peers}
        assert g.primary_etf.upper() not in peer_set, g.registry_key


def test_min_peers_reasonable() -> None:
    from stocvest.data.sector_peer_registry import _PEER_GROUPS

    for g in _PEER_GROUPS.values():
        assert g.min_peers_for_signal >= 2, g.registry_key
    assert _PEER_GROUPS["anthropic_ecosystem"].min_peers_for_signal == 2


def test_symbol_excluded_from_own_group_average() -> None:
    """Chunk 4A must exclude the subject from peer averages; registry includes NVDA in semis."""
    g = get_peer_group("NVDA")
    assert g is not None
    assert g.registry_key == "semiconductors"
    assert "NVDA" in g.peers


def test_is_etf() -> None:
    assert is_etf("SOXX") is True
    assert is_etf("NVDA") is False


def test_get_pre_ipo_proxy_groups() -> None:
    proxies = get_pre_ipo_proxy_groups()
    assert len(proxies) >= 5
    assert all(g.group_type == PeerGroupType.PRE_IPO_PROXY for g in proxies)

"""Dynamic cluster detector tests (Chunk 4B)."""

from __future__ import annotations

from stocvest.data.sector_peer_registry import PeerGroupType
from stocvest.signals.dynamic_cluster_detector import (
    build_cluster_around_leader,
    clusters_to_peer_groups,
    compute_dominance_score,
    compute_universe_stats,
    detect_all_dynamic_clusters,
    detect_emerging_leaders,
)
from stocvest.signals.dynamic_cluster_detector import _dedupe_clusters, DynamicCluster


class _FakeCache:
    def __init__(self, data: dict[str, dict[str, float]]) -> None:
        self._data = {k.upper(): v for k, v in data.items()}

    def get_1d_change(self, symbol: str) -> float | None:
        row = self._data.get(symbol.upper(), {})
        return row.get("d1")

    def get_5d_change(self, symbol: str) -> float | None:
        row = self._data.get(symbol.upper(), {})
        return row.get("d5")

    def get_volume_ratio(self, symbol: str) -> float:
        row = self._data.get(symbol.upper(), {})
        return float(row.get("vol", 1.0))

    def list_cached_symbols(self) -> list[str]:
        return sorted(self._data.keys())


def _stats(moves: dict[str, float], vols: dict[str, float] | None = None) -> dict:
    cache = _FakeCache({s: {"d1": m, "vol": (vols or {}).get(s, 1.0)} for s, m in moves.items()})
    return compute_universe_stats(list(moves.keys()), cache)


def test_dominance_score_high_for_outlier() -> None:
    stats = _stats(
        {
            "A": 0.3,
            "B": 0.4,
            "C": 0.2,
            "D": 0.5,
            "E": 0.35,
            "F": 0.25,
            "G": 0.4,
            "H": 0.3,
            "OUT": 5.0,
        },
        {"OUT": 2.0},
    )
    score = compute_dominance_score("OUT", 5.0, 2.0, stats)
    assert score > 2.0


def test_dominance_score_low_for_normal_move() -> None:
    stats = _stats(
        {
            "A": 0.8,
            "B": 0.9,
            "C": 0.7,
            "D": 1.0,
            "E": 0.85,
            "F": 0.75,
            "G": 0.9,
            "H": 0.8,
            "OUT": 1.2,
        }
    )
    score = compute_dominance_score("OUT", 1.2, 1.0, stats)
    assert score < 2.0


def test_emerging_leaders_threshold() -> None:
    moves = {f"S{i}": 0.3 for i in range(8)}
    moves["LEAD1"] = 8.0
    moves["LEAD2"] = 7.5
    vols = {"LEAD1": 3.0, "LEAD2": 2.5}
    stats = _stats(moves, vols)
    leaders = detect_emerging_leaders(
        stats,
        _FakeCache({s: {"d1": m, "vol": vols.get(s, 1.0)} for s, m in moves.items()}),
    )
    assert len(leaders) == 2
    assert leaders[0] == "LEAD1"


def test_cluster_built_correctly() -> None:
    stats = _stats(
        {
            "SPCX": 8.0,
            "RKLB": 5.0,
            "ASTS": 4.0,
            "NVDA": 1.0,
            "XYZ": -1.0,
        }
    )
    cluster = build_cluster_around_leader("SPCX", 8.0, stats, min_correlation_pct=0.50)
    assert cluster is not None
    assert set(cluster.cluster_symbols) == {"SPCX", "RKLB", "ASTS"}
    assert cluster.cluster_direction == "up"


def test_leader_is_ipo_mode_for_unseasoned_listing() -> None:
    from stocvest.signals.dynamic_cluster_detector import leader_is_ipo_mode

    assert leader_is_ipo_mode("SPCX") is True
    assert leader_is_ipo_mode("AAPL") is False


def test_cluster_too_small_returns_none() -> None:
    stats = _stats({"SPCX": 8.0, "RKLB": 5.0})
    assert build_cluster_around_leader("SPCX", 8.0, stats, min_cluster_size=3) is None


def test_deduplication_removes_overlap() -> None:
    a = DynamicCluster(
        leader_symbol="A",
        leader_move_1d=5.0,
        leader_dominance_score=3.0,
        cluster_symbols=("A", "B", "C", "D"),
        cluster_direction="up",
        cluster_size=4,
        is_ipo_mode=False,
        driver_label="cluster A",
    )
    b = DynamicCluster(
        leader_symbol="B",
        leader_move_1d=4.5,
        leader_dominance_score=2.5,
        cluster_symbols=("B", "C", "D", "E"),
        cluster_direction="up",
        cluster_size=4,
        is_ipo_mode=False,
        driver_label="cluster B",
    )
    out = _dedupe_clusters([a, b])
    assert len(out) == 1
    assert out[0].leader_symbol == "A"


def test_clusters_to_peer_groups_format() -> None:
    cluster = DynamicCluster(
        leader_symbol="SPCX",
        leader_move_1d=8.0,
        leader_dominance_score=3.0,
        cluster_symbols=("SPCX", "RKLB", "ASTS", "MNTS"),
        cluster_direction="up",
        cluster_size=4,
        is_ipo_mode=False,
        driver_label="Dynamic cluster: SPCX driving 4 stocks",
    )
    groups = clusters_to_peer_groups([cluster])
    assert len(groups) == 1
    g = groups[0]
    assert g.group_type == PeerGroupType.THEME
    assert g.requires_etf_confirmation is False
    assert g.primary_etf is None
    assert len(g.peers) == 4


def test_empty_cache_returns_empty_list() -> None:
    cache = _FakeCache({})
    assert detect_all_dynamic_clusters(cache) == []


def test_division_by_zero_protected() -> None:
    moves = {f"S{i}": 1.0 for i in range(6)}
    stats = compute_universe_stats(list(moves.keys()), _FakeCache({s: {"d1": 1.0, "vol": 1.0} for s in moves}))
    score = compute_dominance_score("S0", 1.0, 1.0, stats)
    assert score == score  # no exception


def test_detect_all_dynamic_clusters_pipeline() -> None:
    data = {f"S{i}": {"d1": 0.3, "vol": 1.0} for i in range(8)}
    data["LEAD"] = {"d1": 6.0, "vol": 2.2}
    data["P1"] = {"d1": 4.0, "vol": 1.5}
    data["P2"] = {"d1": 3.5, "vol": 1.4}
    cache = _FakeCache(data)
    clusters = detect_all_dynamic_clusters(cache, min_dominance_score=2.0, min_cluster_size=3)
    assert len(clusters) >= 1
    assert clusters[0].leader_symbol == "LEAD"

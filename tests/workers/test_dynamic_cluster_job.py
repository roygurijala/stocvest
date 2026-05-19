"""Dynamic cluster precompute worker tests (Chunk 9)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from stocvest.signals.dynamic_cluster_detector import DynamicCluster
from stocvest.workers.dynamic_cluster_job import handler, run_dynamic_cluster_precompute


def test_handler_returns_200_with_cluster_count() -> None:
    cluster = DynamicCluster(
        leader_symbol="SPCX",
        leader_move_1d=8.0,
        leader_dominance_score=3.0,
        cluster_symbols=("SPCX", "RKLB", "ASTS"),
        cluster_direction="up",
        cluster_size=3,
        is_ipo_mode=False,
        driver_label="Dynamic cluster: SPCX driving 3 stocks",
    )
    with patch(
        "stocvest.workers.dynamic_cluster_job.get_or_compute_dynamic_clusters",
        return_value=[cluster],
    ):
        resp = handler({}, None)
    assert resp["statusCode"] == 200
    assert resp["clusters_found"] == 1


def test_run_returns_empty_on_no_cache() -> None:
    with patch(
        "stocvest.workers.dynamic_cluster_job.get_or_compute_dynamic_clusters",
        return_value=[],
    ):
        body = run_dynamic_cluster_precompute()
    assert body["clusters_found"] == 0


def test_handler_never_raises() -> None:
    with patch(
        "stocvest.workers.dynamic_cluster_job.run_dynamic_cluster_precompute",
        side_effect=RuntimeError("redis"),
    ):
        resp = handler({}, None)
    assert resp["statusCode"] == 200
    assert resp["clusters_found"] == 0

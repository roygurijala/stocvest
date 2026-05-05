"""FIX 3–5: portfolio auto-log gate, observability, Claude model id, reversal isolation."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.models import Snapshot
from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal


def test_claude_model_name_is_correct() -> None:
    root = Path(__file__).resolve().parents[2]
    skip_parts = (".git", "__pycache__", "node_modules", ".next", ".venv", "venv", "dist", "build")
    exts = {".py", ".ts", ".tsx", ".tf", ".yml", ".yaml", ".md", ".json"}
    needle = "claude" + "-" + "3"
    claude3_hits: list[str] = []
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        parts = path.parts
        if any(s in parts for s in skip_parts):
            continue
        if path.suffix.lower() not in exts:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if needle in text:
            claude3_hits.append(str(path.relative_to(root)))
    assert not claude3_hits, f"unexpected legacy Claude v3 model id substring in: {claude3_hits}"

    from stocvest.signals import geopolitical_scanner, news_sentiment

    assert news_sentiment.DEFAULT_MODEL == "claude-sonnet-4-6"
    assert geopolitical_scanner.DEFAULT_MODEL == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_portfolio_reversal_no_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.api.handlers.signal_resolution as sr
    from stocvest.api.services.portfolio_reversal import CompositeVerdictOnly

    schedule_mock = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.schedule_model_portfolio_log_from_composite",
        schedule_mock,
    )
    rec_sig = MagicMock()
    monkeypatch.setattr("stocvest.api.services.signal_recorder.get_signal_recorder", lambda: rec_sig)

    verdict_mock = AsyncMock(
        return_value=CompositeVerdictOnly(status="ok", signal_summary="bearish", score_0_100=30)
    )
    monkeypatch.setattr("stocvest.api.services.portfolio_reversal.get_composite_verdict_only", verdict_mock)

    pr = MagicMock()
    pr.get_open_positions.return_value = [{"symbol": "AAPL", "position_id": "pos-1"}]
    pr.close_position.return_value = True
    monkeypatch.setattr("stocvest.api.services.portfolio_recorder.get_portfolio_recorder", lambda: pr)

    class _FakeClient:
        async def get_snapshot(self, sym: str) -> Snapshot:
            return Snapshot(symbol=sym, last_trade_price=100.0)

        async def __aenter__(self) -> _FakeClient:
            return self

        async def __aexit__(self, *a: object) -> None:
            return None

    class _FakePoly:
        def __init__(self, *a: object, **k: object) -> None:
            pass

        async def __aenter__(self) -> _FakeClient:
            return _FakeClient()

        async def __aexit__(self, *a: object) -> None:
            return None

    monkeypatch.setattr(sr, "PolygonClient", _FakePoly)
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    out = await sr._portfolio_reversal_async()
    assert out.get("closed") == 1
    schedule_mock.assert_not_called()
    rec_sig.record_signal.assert_not_called()


@pytest.mark.asyncio
async def test_http_composite_does_not_auto_log(monkeypatch: pytest.MonkeyPatch) -> None:
    schedule_mock = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.schedule_model_portfolio_log_from_composite",
        schedule_mock,
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.run_real_composite_engine_phase",
        AsyncMock(return_value={"symbol": "X", "status": "insufficient_data"}),
    )
    from stocvest.api.services.real_composite_engine import build_real_composite_response

    await build_real_composite_response(
        symbol="AAPL",
        user_id="u1",
        user_email="a@b.c",
        params=default_signal_parameters(),
        enable_portfolio_log=False,
    )
    schedule_mock.assert_not_called()


def _bullish_phase() -> Any:
    signals = [
        LayerSignal(layer="technical", score=0.75, confidence=1.0),
        LayerSignal(layer="news", score=0.72, confidence=1.0),
        LayerSignal(layer="macro", score=0.70, confidence=1.0),
        LayerSignal(layer="sector", score=0.71, confidence=1.0),
        LayerSignal(layer="geopolitical", score=0.68, confidence=1.0),
        LayerSignal(layer="internals", score=0.69, confidence=1.0),
    ]
    composite = CompositeScoreEngine(
        bullish_threshold=0.15,
        bearish_threshold=-0.15,
    ).compute(signals, regime="bull")
    tech = SimpleNamespace(
        status="available",
        score=80,
        verdict="bullish",
        reasoning="",
        chips=[],
        orb_signal="orb_long",
        volume_vs_adv=2.0,
        ema9=100.0,
    )
    news = SimpleNamespace(
        status="available",
        score=75,
        verdict="bullish",
        reasoning="",
        chips=[],
        catalyst_headline=None,
        weighted_sentiment=0.5,
    )
    macro = SimpleNamespace(
        status="available",
        score=70,
        verdict="bullish",
        reasoning="",
        chips=[],
        market_regime="risk_on",
        spy_day_pct=0.4,
    )
    sector = SimpleNamespace(
        status="available",
        score=72,
        verdict="bullish",
        reasoning="",
        chips=[],
        sector_signal="bullish",
        sector_etf="XLK",
        sector_day_pct=0.2,
    )
    geo = SimpleNamespace(
        status="available",
        score=65,
        verdict="neutral",
        reasoning="",
        chips=[],
        high_impact_count=0,
    )
    internals = SimpleNamespace(
        status="available",
        score=68,
        verdict="bullish",
        reasoning="",
        chips=[],
        vix_price=18.0,
    )
    layer_results = [tech, news, macro, sector, geo, internals]
    layer_ids = ["technical", "news", "macro", "sector", "geopolitical", "internals"]
    from stocvest.api.services.real_composite_engine import RealCompositeEnginePhase

    return RealCompositeEnginePhase(
        sym="AAPL",
        sym_snap=Snapshot(symbol="AAPL", last_trade_price=150.0, prev_close=148.0),
        bars=[],
        news_rows=[],
        layer_results=layer_results,
        layer_ids=layer_ids,
        signals=signals,
        regime="bull",
        composite=composite,
    )


@pytest.mark.asyncio
async def test_portfolio_log_fires_when_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    schedule_mock = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.schedule_model_portfolio_log_from_composite",
        schedule_mock,
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.run_real_composite_engine_phase",
        AsyncMock(return_value=_bullish_phase()),
    )
    class _FakeConfluence:
        def calculate_confluence(self, **kwargs: Any) -> MagicMock:
            return MagicMock(
                confluence_score=0,
                tier="",
                is_confluence_alert=False,
                confirming_signals=[],
                conflicting_signals=[],
                n_confirming=0,
                n_conflicting=0,
                historical_note="",
                disclaimer="",
            )

    monkeypatch.setattr("stocvest.api.services.real_composite_engine.ConfluenceDetector", _FakeConfluence)
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.confluence_result_to_response_fields",
        lambda _r: {
            "confluence_score": 0,
            "confluence_tier": "",
            "is_confluence_alert": False,
            "confirming_signals": [],
            "conflicting_signals": [],
            "n_confirming": 0,
            "n_conflicting": 0,
            "historical_note": "",
            "confluence_disclaimer": "",
        },
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.build_swing_composite_evidence_fields",
        lambda **k: {},
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.build_real_composite_snapshot_payload",
        lambda **k: {
            "technical_snapshot_json": None,
            "news_snapshot_json": None,
            "macro_snapshot_json": None,
            "sector_snapshot_json": None,
            "internals_snapshot_json": None,
            "layer_scores_json": None,
        },
    )
    rec = MagicMock()
    monkeypatch.setattr("stocvest.api.services.real_composite_engine.get_signal_recorder", lambda: rec)
    from stocvest.api.services.real_composite_engine import build_real_composite_response

    await build_real_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
        enable_portfolio_log=True,
    )
    assert schedule_mock.call_count == 1


@pytest.mark.asyncio
async def test_composite_scoring_emits_log_line(monkeypatch: pytest.MonkeyPatch) -> None:
    info_calls: list[tuple[str, tuple[Any, ...]]] = []

    def _capture(msg: str, *args: Any) -> None:
        info_calls.append((msg, args))

    monkeypatch.setattr("stocvest.api.services.real_composite_engine._LOG.info", _capture)
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.run_real_composite_engine_phase",
        AsyncMock(return_value=_bullish_phase()),
    )
    class _FakeConfluence:
        def calculate_confluence(self, **kwargs: Any) -> MagicMock:
            return MagicMock(
                confluence_score=0,
                tier="",
                is_confluence_alert=False,
                confirming_signals=[],
                conflicting_signals=[],
                n_confirming=0,
                n_conflicting=0,
                historical_note="",
                disclaimer="",
            )

    monkeypatch.setattr("stocvest.api.services.real_composite_engine.ConfluenceDetector", _FakeConfluence)
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.confluence_result_to_response_fields",
        lambda _r: {
            "confluence_score": 0,
            "confluence_tier": "",
            "is_confluence_alert": False,
            "confirming_signals": [],
            "conflicting_signals": [],
            "n_confirming": 0,
            "n_conflicting": 0,
            "historical_note": "",
            "confluence_disclaimer": "",
        },
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.build_swing_composite_evidence_fields",
        lambda **k: {},
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.build_real_composite_snapshot_payload",
        lambda **k: {
            "technical_snapshot_json": None,
            "news_snapshot_json": None,
            "macro_snapshot_json": None,
            "sector_snapshot_json": None,
            "internals_snapshot_json": None,
            "layer_scores_json": None,
        },
    )
    monkeypatch.setattr("stocvest.api.services.real_composite_engine.get_signal_recorder", lambda: MagicMock())
    from stocvest.api.services.real_composite_engine import build_real_composite_response

    await build_real_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
        enable_portfolio_log=False,
    )
    joined = " ".join((m % a if a else m) for m, a in info_calls)
    assert "composite scored" in joined


def test_portfolio_open_emits_log_line(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services.portfolio_recorder import PortfolioRecorder

    table = MagicMock()
    res = MagicMock()
    res.Table.return_value = table
    table.query.return_value = {"Items": []}
    info_lines: list[str] = []

    def _info(msg: str, *args: Any) -> None:
        info_lines.append(msg % args if args else msg)

    monkeypatch.setattr("stocvest.api.services.portfolio_recorder.boto3.resource", lambda *a, **k: res)
    monkeypatch.setattr("stocvest.api.services.portfolio_recorder.log", MagicMock(info=_info))
    rec = PortfolioRecorder()
    pid = rec.open_position(
        symbol="AAPL",
        entry_price=100.0,
        signal_score=75,
        entry_reason="test",
        layer_scores={"technical": 80},
        layer_verdicts={"technical": "bullish"},
        layer_chips={"technical": ["x"]},
        confluence_fired=False,
        confluence_score=0,
        market_regime="neutral",
        vix_at_entry=18.0,
        spy_day_pct=0.1,
        sector_etf="XLK",
        sector_day_pct=0.2,
        parameter_version="1.0.0",
    )
    assert pid is not None
    assert any("Portfolio: opened symbol=" in line for line in info_lines)


def test_run_portfolio_scanner_for_symbol_uses_enabled_log(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, Any] = {}

    async def _fake_build(**kwargs: Any) -> dict[str, Any]:
        called.update(kwargs)
        return {"symbol": "MSFT", "status": "insufficient_data"}

    monkeypatch.setattr(
        "stocvest.api.services.portfolio_reversal.build_real_composite_response",
        _fake_build,
    )
    from stocvest.api.services.portfolio_reversal import run_portfolio_scanner_for_symbol

    out = run_portfolio_scanner_for_symbol("msft")
    assert out.get("status") == "insufficient_data"
    assert called.get("enable_portfolio_log") is True
    assert called.get("symbol") == "msft"


def test_portfolio_auto_log_skip_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services import portfolio_auto_log as pal
    from stocvest.signals.composite_score import CompositeVerdict

    lines: list[str] = []

    def _info(msg: str, *args: Any) -> None:
        lines.append(msg % args if args else msg)

    monkeypatch.setattr(pal._LOG, "info", _info)
    monkeypatch.setattr(pal, "run_alert_background", lambda fn: None)

    pal.schedule_model_portfolio_log_from_composite(
        symbol="ZZ",
        composite_verdict=CompositeVerdict.BULLISH,
        composite_score=50,
        entry_price=10.0,
        layer_results=[],
        macro_regime="neutral",
        confluence_fired=False,
        confluence_score=0,
        vix_at_entry=None,
        spy_day_pct=None,
        sector_etf=None,
        sector_day_pct=None,
        parameter_version="1.0.0",
    )
    assert any("below_threshold" in s for s in lines)

    lines.clear()
    pal.schedule_model_portfolio_log_from_composite(
        symbol="ZZ",
        composite_verdict=CompositeVerdict.BULLISH,
        composite_score=80,
        entry_price=10.0,
        layer_results=[],
        macro_regime="avoid",
        confluence_fired=False,
        confluence_score=0,
        vix_at_entry=None,
        spy_day_pct=None,
        sector_etf=None,
        sector_day_pct=None,
        parameter_version="1.0.0",
    )
    assert any("avoid_regime" in s for s in lines)

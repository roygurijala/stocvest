from __future__ import annotations

import logging

import pytest

from stocvest.utils.logging import get_logger


@pytest.mark.unit
def test_get_logger_sets_debug_in_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_ENV", "development")
    name = "stocvest.test_logging.dev"
    logging.getLogger(name).handlers.clear()
    logging.getLogger(name).propagate = True
    logger = get_logger(name)
    assert logger.level == logging.DEBUG
    assert len(logger.handlers) == 1


@pytest.mark.unit
def test_get_logger_sets_info_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_ENV", "production")
    name = "stocvest.test_logging.prod"
    logging.getLogger(name).handlers.clear()
    logging.getLogger(name).propagate = True
    logger = get_logger(name)
    assert logger.level == logging.INFO


@pytest.mark.unit
def test_get_logger_idempotent_for_same_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_ENV", "development")
    name = "stocvest.test_logging.idem"
    base = logging.getLogger(name)
    base.handlers.clear()
    base.propagate = True
    a = get_logger(name)
    b = get_logger(name)
    assert a is b
    assert len(a.handlers) == 1

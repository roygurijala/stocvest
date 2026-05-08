from __future__ import annotations

import time

import pytest

from stocvest.utils.circuit_breaker import CircuitBreaker, CircuitOpenError


def test_circuit_closed_initially() -> None:
    cb = CircuitBreaker("t")
    assert cb.state == "CLOSED"


def test_circuit_opens_after_threshold() -> None:
    cb = CircuitBreaker("t", failure_threshold=3, recovery_timeout=30)

    def fail():
        raise ValueError("x")

    for _ in range(3):
        with pytest.raises(ValueError):
            cb.call(fail)
    assert cb.state == "OPEN"


def test_circuit_open_raises_fast() -> None:
    cb = CircuitBreaker("t", failure_threshold=1, recovery_timeout=3600)

    def fail():
        raise ValueError("x")

    with pytest.raises(ValueError):
        cb.call(fail)
    assert cb.state == "OPEN"

    with pytest.raises(CircuitOpenError):
        cb.call(lambda: 1)


def test_circuit_recovers_after_timeout() -> None:
    cb = CircuitBreaker("t", failure_threshold=1, recovery_timeout=1)
    cb._state = "OPEN"
    cb._last_failure_time = time.time() - 2

    def ok():
        return 42

    assert cb.call(ok) == 42
    assert cb.state == "CLOSED"


def test_success_resets_failure_count() -> None:
    cb = CircuitBreaker("t", failure_threshold=3, recovery_timeout=30)

    def fail():
        raise RuntimeError("n")

    with pytest.raises(RuntimeError):
        cb.call(fail)
    with pytest.raises(RuntimeError):
        cb.call(fail)

    assert cb.call(lambda: 1) == 1
    assert cb._failures == 0

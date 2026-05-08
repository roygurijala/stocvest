"""Upstream circuit breaker — fail fast after repeated errors."""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, TypeVar

_LOG = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    """Raised when the circuit is open and recovery window has not elapsed."""


class CircuitBreaker:
    """
    States: CLOSED (normal), OPEN (fail fast), HALF_OPEN (single trial).

    Opens after ``failure_threshold`` consecutive failures; recovery after
    ``recovery_timeout`` seconds.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: int = 30,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures = 0
        self._state = "CLOSED"
        self._last_failure_time: float | None = None

    @property
    def state(self) -> str:
        return self._state

    def call(self, func: Callable[[], T], *args: Any, **kwargs: Any) -> T:
        if self._state == "OPEN":
            if self._should_attempt_recovery():
                self._state = "HALF_OPEN"
            else:
                raise CircuitOpenError(f"{self.name} circuit is open")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            raise

    def _on_success(self) -> None:
        self._failures = 0
        self._state = "CLOSED"

    def _on_failure(self) -> None:
        self._failures += 1
        self._last_failure_time = time.time()
        if self._failures >= self.failure_threshold:
            self._state = "OPEN"
            _LOG.warning("circuit_opened name=%s failures=%s", self.name, self._failures)

    def _should_attempt_recovery(self) -> bool:
        if not self._last_failure_time:
            return True
        return time.time() - self._last_failure_time > self.recovery_timeout


polygon_circuit = CircuitBreaker("polygon")
benzinga_circuit = CircuitBreaker("benzinga")
claude_circuit = CircuitBreaker("claude")
perplexity_circuit = CircuitBreaker("perplexity")

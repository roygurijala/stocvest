"""Fire-and-forget alert delivery so HTTP handlers never block on SES."""

from __future__ import annotations

import threading
from collections.abc import Callable

from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def run_alert_background(fn: Callable[[], None]) -> None:
    def _wrap() -> None:
        try:
            fn()
        except Exception:
            _LOG.exception("alert background task failed")

    threading.Thread(target=_wrap, daemon=True).start()

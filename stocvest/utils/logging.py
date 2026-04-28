"""
Structured logging.

Rules (from session contract):
  - Never log prices, account numbers, or credentials
  - Log at INFO in production, DEBUG in development
"""

from __future__ import annotations

import logging
import os
import sys


def get_logger(name: str) -> logging.Logger:
    """Return a named logger configured for STOCVEST."""
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger  # already configured

    level_name = "DEBUG" if os.getenv("STOCVEST_ENV", "development") == "development" else "INFO"
    logger.setLevel(getattr(logging, level_name))

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(getattr(logging, level_name))

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False

    return logger

"""Broker-layer exceptions (stable types for all adapters)."""


class BrokerError(Exception):
    """Base class for broker failures."""


class BrokerAuthError(BrokerError):
    """Invalid, expired, or missing credentials."""


class BrokerRateLimitError(BrokerError):
    """Transient rate limit — safe to retry with backoff."""


class BrokerNotFoundError(BrokerError):
    """Account, order, or symbol not found."""


class BrokerRejectedError(BrokerError):
    """Order or action rejected by the broker (business rule or risk)."""


class BrokerUnavailableError(BrokerError):
    """Connectivity or service outage."""


class BrokerNotImplementedError(BrokerError):
    """Adapter shell present but execution path not implemented yet (Phase 3c/3d)."""

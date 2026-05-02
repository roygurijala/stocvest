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


class PDTViolationError(BrokerRejectedError):
    """Pattern day trader rule would be violated."""


class InsufficientFundsError(BrokerRejectedError):
    """Estimated order cost exceeds available buying power."""


class MarketClosedError(BrokerRejectedError):
    """Order type not allowed for current market session."""


class UnknownSymbolError(BrokerRejectedError):
    """Symbol is missing or not a supported equity."""


class OrderQuantityLimitError(BrokerRejectedError):
    """Order size exceeds configured safety maximum."""


class OrderRejectedError(BrokerRejectedError):
    """Validation failed; may carry a structured ``validation_result``."""

    def __init__(self, message: str, validation_result: object | None = None) -> None:
        super().__init__(message)
        self.validation_result = validation_result


class BrokerUnavailableError(BrokerError):
    """Connectivity or service outage."""


class BrokerNotImplementedError(BrokerError):
    """Adapter shell present but execution path not implemented yet (Phase 3c/3d)."""

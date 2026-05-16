"""Shared legal disclaimer strings for API responses."""

API_SIGNAL_DISCLAIMER = "Signal data for informational purposes only. Not investment advice."

#: Historical Signal Validation disclaimer — single-sourced so the assistant prompt, the
#: ``/v1/signals/historical-validation/summary`` endpoint, the upcoming dashboard tab, and
#: the public ``/performance`` mirror cannot drift from the verbatim phrase. The wording
#: is intentionally restrictive: validation **measures** past behavior under the recorded
#: rules; it never frames that behavior as a forecast.
HISTORICAL_VALIDATION_DISCLAIMER = "Historical signal accuracy does not guarantee future results."

#: B33 per-symbol evaluation trace — must stay aligned with scanner UI copy.
SCANNER_EVALUATION_TRACE_DISCLAIMER = (
    "Symbols listed were evaluated by the engine but did not qualify. "
    "This is not a watchlist and not a trade recommendation."
)

import React from "react";
import type { PDTStatusPayload } from "@/lib/api/pdt";

interface PDTStatusWidgetProps {
  status: PDTStatusPayload | null;
}

export function getPdtWarningMessage(status: PDTStatusPayload | null): string {
  if (!status) {
    return "PDT status unavailable.";
  }
  const a = status.assessment;
  if (a.at_limit) {
    return "PDT limit reached: additional day trades are blocked until reset or exemption.";
  }
  if (a.warn_near_limit && a.current_day_trade_count >= 2) {
    return "Warning: 2 day trades used in the 5-business-day window. One slot remains.";
  }
  return "PDT status is within limits.";
}

export function PDTStatusWidget({ status }: PDTStatusWidgetProps) {
  if (!status) {
    return (
      <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>PDT Guardrail</h3>
        <p style={{ opacity: 0.85 }}>PDT status unavailable.</p>
      </article>
    );
  }

  const a = status.assessment;
  const color = a.at_limit ? "#fda4af" : a.warn_near_limit ? "#facc15" : "#4ade80";
  const label = a.at_limit ? "BLOCKED" : a.warn_near_limit ? "WARNING" : "OK";
  const warningMessage = getPdtWarningMessage(status);

  return (
    <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>PDT Guardrail</h3>
      <p style={{ margin: "0 0 8px 0" }}>
        Status: <strong style={{ color }}>{label}</strong>
      </p>
      <p style={{ margin: "0 0 8px 0", opacity: 0.9 }}>
        Day trades: {a.current_day_trade_count}/{a.max_non_exempt} in {a.rolling_business_days} business days
      </p>
      <p style={{ margin: 0, opacity: 0.9 }}>
        Next day trade allowed: <strong>{a.allow_next_day_trade ? "Yes" : "No"}</strong>
      </p>
      <p style={{ margin: "8px 0 0 0", opacity: 0.9 }}>
        Days until reset: <strong>{a.days_until_reset}</strong>
      </p>
      <p style={{ margin: "8px 0 0 0", color }}>{warningMessage}</p>
    </article>
  );
}

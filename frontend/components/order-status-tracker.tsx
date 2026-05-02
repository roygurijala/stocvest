"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { borderRadius, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { BrokerKind } from "@/lib/api/brokers";

const REJECTION_MAP: Record<string, string> = {
  ERR_MARGIN_4031: "Insufficient buying power",
  OUTSIDE_RTH: "Market is closed",
  PDT_VIOLATION: "PDT limit reached"
};

function humanReject(reason: string | null | undefined): string {
  if (!reason) return "Order was rejected.";
  const trimmed = reason.trim();
  if (REJECTION_MAP[trimmed]) return REJECTION_MAP[trimmed];
  for (const [code, msg] of Object.entries(REJECTION_MAP)) {
    if (trimmed.includes(code)) return msg;
  }
  return trimmed;
}

interface OrderStatusTrackerProps {
  broker: BrokerKind;
  accountId: string;
  clientOrderId: string;
  onDone?: () => void;
}

export function OrderStatusTracker({ broker, accountId, clientOrderId, onDone }: OrderStatusTrackerProps) {
  const { colors } = useTheme();
  const [line, setLine] = useState("Order submitted — awaiting fill");
  const [tone, setTone] = useState<"pending" | "ok" | "warn" | "bad" | "neutral">("pending");
  const terminalRef = useRef(false);

  useEffect(() => {
    const started = Date.now();
    let intervalId = 0;
    const tick = async () => {
      if (terminalRef.current) return;
      try {
        const res = await fetch(
          `/api/stocvest/orders/${encodeURIComponent(clientOrderId)}/status?broker=${encodeURIComponent(broker)}&account_id=${encodeURIComponent(accountId)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          if (Date.now() - started > 60_000) {
            setLine("Status unknown. Check your broker app.");
            setTone("warn");
            terminalRef.current = true;
            window.clearInterval(intervalId);
            onDone?.();
          }
          return;
        }
        const data = (await res.json()) as {
          status?: string;
          quantity_ordered?: number;
          quantity_filled?: number;
          average_fill_price?: number | null;
          reject_reason?: string | null;
        };
        const st = (data.status || "").toLowerCase();
        if (st === "filled") {
          const px = data.average_fill_price != null ? `$${data.average_fill_price.toFixed(2)}` : "";
          const t = new Date().toLocaleTimeString();
          setLine(`Filled ${data.quantity_filled ?? data.quantity_ordered ?? ""} shares ${px ? `@ ${px} ` : ""}at ${t}`);
          setTone("ok");
          terminalRef.current = true;
          window.clearInterval(intervalId);
          onDone?.();
          return;
        }
        if (st === "partially_filled") {
          setLine(
            `Partially filled: ${data.quantity_filled ?? 0} of ${data.quantity_ordered ?? ""} shares${data.average_fill_price != null ? ` @ $${data.average_fill_price.toFixed(2)}` : ""}. Remaining: ${(Number(data.quantity_ordered) || 0) - (Number(data.quantity_filled) || 0)}.`
          );
          setTone("warn");
        }
        if (st === "rejected") {
          setLine(humanReject(data.reject_reason));
          setTone("bad");
          terminalRef.current = true;
          window.clearInterval(intervalId);
          onDone?.();
          return;
        }
        if (st === "cancelled") {
          setLine("Order cancelled");
          setTone("neutral");
          terminalRef.current = true;
          window.clearInterval(intervalId);
          onDone?.();
          return;
        }
      } catch {
        if (Date.now() - started > 60_000) {
          setLine("Status unknown. Check your broker app.");
          setTone("warn");
          terminalRef.current = true;
          window.clearInterval(intervalId);
          onDone?.();
        }
      }
    };
    intervalId = window.setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      window.clearInterval(intervalId);
    };
  }, [broker, accountId, clientOrderId, onDone]);

  const icon =
    tone === "pending" ? (
      <Loader2 className="animate-spin" size={22} style={{ color: colors.accent }} />
    ) : tone === "ok" ? (
      <Check size={22} style={{ color: colors.bullish }} />
    ) : tone === "bad" ? (
      <X size={22} style={{ color: colors.bearish }} />
    ) : (
      <Loader2 size={22} style={{ color: colors.caution }} />
    );

  return (
    <div
      className="flex items-start gap-3 p-4"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        fontSize: typography.scale.sm
      }}
    >
      {icon}
      <p style={{ margin: 0, color: colors.text }}>{line}</p>
    </div>
  );
}

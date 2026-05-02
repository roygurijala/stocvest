"use client";

import { useEffect, useState } from "react";
import type { TradingModeUi } from "@/components/trading-mode-badge";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { BrokerKind, OrderType, TimeInForce } from "@/lib/api/brokers";

export interface OrderDraft {
  broker: BrokerKind;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: OrderType;
  timeInForce: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  clientOrderId: string;
  availableCash: number;
  isDayTrade: boolean;
}

interface ValidationShape {
  is_valid?: boolean;
  warnings?: string[];
  errors?: string[];
  estimated_cost?: number;
  estimated_value?: number;
  pdt_trades_used?: number;
  pdt_trades_remaining?: number;
  is_paper_mode?: boolean;
  current_bid?: number;
  current_ask?: number;
  spread_pct?: number;
}

interface OrderConfirmationModalProps {
  open: boolean;
  draft: OrderDraft | null;
  tradingMode: TradingModeUi;
  onClose: () => void;
  onAccepted: (clientOrderId: string) => void;
}

export function OrderConfirmationModal({ open, draft, tradingMode, onClose, onAccepted }: OrderConfirmationModalProps) {
  const { colors } = useTheme();
  const [readyMs, setReadyMs] = useState(0);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pdtUsed, setPdtUsed] = useState(0);
  const [preview, setPreview] = useState<ValidationShape | null>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setInlineError(null);
    setPreview(null);
    setReadyMs(0);
    const t0 = Date.now();
    const id = window.setInterval(() => setReadyMs(Date.now() - t0), 100);
    return () => window.clearInterval(id);
  }, [open, draft]);

  useEffect(() => {
    if (!open || !draft) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/pdt/status");
        if (!res.ok) return;
        const data = (await res.json()) as { assessment?: { day_trades_in_window?: number } };
        const n = data.assessment?.day_trades_in_window;
        if (!cancelled && typeof n === "number") setPdtUsed(n);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, draft]);

  if (!open || !draft) return null;

  const canConfirm = readyMs >= 2000;
  const waitLabel = canConfirm ? "Confirm Order" : `Confirm Order (${Math.ceil((2000 - readyMs) / 1000)}s)`;

  async function runConfirm() {
    if (!draft) return;
    setInlineError(null);
    const body = {
      symbol: draft.symbol,
      side: draft.side,
      quantity: draft.quantity,
      order_type: draft.orderType,
      time_in_force: draft.timeInForce,
      client_order_id: draft.clientOrderId,
      limit_price: draft.limitPrice,
      stop_price: draft.stopPrice,
      account_id: draft.accountId,
      broker: draft.broker,
      available_cash: draft.availableCash,
      is_day_trade: draft.isDayTrade
    };
    const v = await fetch("/api/stocvest/orders/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const vJson = (await v.json()) as ValidationShape & { message?: string; error?: string };
    if (!v.ok) {
      setInlineError(vJson.message || vJson.error || "Validation failed.");
      return;
    }
    setPreview(vJson);
    if (vJson.is_valid === false) {
      setInlineError(vJson.errors?.join(" ") || "Order did not pass validation.");
      return;
    }
    const s = await fetch("/api/stocvest/orders/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, confirmed: true })
    });
    const sJson = (await s.json()) as { client_order_id?: string; message?: string; error?: string };
    if (!s.ok) {
      setInlineError(sJson.message || sJson.error || "Submit failed.");
      return;
    }
    if (sJson.client_order_id) {
      onAccepted(sJson.client_order_id);
    }
  }

  const bid = preview?.current_bid;
  const ask = preview?.current_ask;
  const spread = preview?.spread_pct;
  const est = preview?.estimated_cost ?? preview?.estimated_value;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-4"
        style={{ background: colors.surface, borderRadius: borderRadius.xl, border: `1px solid ${colors.border}` }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span
            className="inline-block rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wide"
            style={{
              background: tradingMode === "paper" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
              color: tradingMode === "paper" ? colors.bullish : colors.bearish,
              border: `1px solid ${tradingMode === "paper" ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.55)"}`
            }}
          >
            {tradingMode === "paper" ? "Paper" : "Live"}
          </span>
        </div>
        <h2 style={{ marginTop: 0 }}>
          {draft.side.toUpperCase()} {draft.quantity} shares of {draft.symbol}
        </h2>
        <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Order type: {draft.orderType}</p>
        {est != null ? (
          <p style={{ marginTop: spacing[2] }}>
            <strong>Estimated cost:</strong> ${est.toFixed(2)}
          </p>
        ) : null}
        {bid != null && ask != null ? (
          <p style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
            Current bid/ask: ${bid.toFixed(2)} / ${ask.toFixed(2)}
            {spread != null ? ` · Spread: ${spread.toFixed(2)}%` : null}
          </p>
        ) : null}
        {pdtUsed >= 2 && pdtUsed < 3 ? (
          <p style={{ color: colors.caution, marginTop: spacing[2] }}>⚠️ PDT: 2 of 3 day trades used</p>
        ) : null}
        {pdtUsed >= 3 ? <p style={{ color: colors.bearish, marginTop: spacing[2] }}>🔴 PDT: Limit reached — blocked</p> : null}
        <hr style={{ borderColor: colors.border, margin: `${spacing[3]} 0` }} />
        <p style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
          This order will be placed directly in your personal brokerage account. STOCVEST does not provide investment advice and is not
          responsible for trading outcomes. You are solely responsible for this order and all resulting gains or losses.
        </p>
        {inlineError ? <p style={{ color: colors.bearish }}>{inlineError}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="min-h-11 rounded-md border px-4" style={{ borderColor: colors.border }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md px-4"
            style={{
              background: canConfirm ? colors.accent : colors.border,
              color: "white",
              border: "none",
              opacity: canConfirm ? 1 : 0.7
            }}
            disabled={!canConfirm || pdtUsed >= 3}
            onClick={() => void runConfirm()}
          >
            {waitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

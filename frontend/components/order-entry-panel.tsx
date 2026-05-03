"use client";

import { useCallback, useEffect, useState } from "react";
import type { BrokerOverview, OrderType, TimeInForce } from "@/lib/api/brokers";
import { OrderConfirmationModal, type OrderDraft, type OrderSignalContext } from "@/components/order-confirmation-modal";
import { OrderStatusTracker } from "@/components/order-status-tracker";
import { TradingModeBadge, type TradingModeUi } from "@/components/trading-mode-badge";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/** Deep-link from scanner → portfolio: query params parsed on the server. */
export interface PortfolioOrderPrefill {
  symbol: string;
  side: "buy" | "sell";
  signal_id?: string;
  signal_strength?: number;
  confluence_score?: number;
  pattern?: string;
  signal_direction?: string;
}

interface OrderEntryPanelProps {
  brokerOverviews: BrokerOverview[];
  defaultAvailableCash?: number;
  orderFromSignal?: PortfolioOrderPrefill | null;
}

export function OrderEntryPanel({ brokerOverviews, defaultAvailableCash = 1_000_000, orderFromSignal = null }: OrderEntryPanelProps) {
  const { colors } = useTheme();
  const accountOptions = brokerOverviews.flatMap((overview) =>
    (overview.accounts || []).map((account) => ({
      broker: overview.broker,
      accountId: account.account_id,
      label: `${overview.broker.toUpperCase()} — ${account.display_name || account.account_id}`
    }))
  );
  const [broker, setBroker] = useState(accountOptions[0]?.broker || "mock");
  const [accountId, setAccountId] = useState(accountOptions[0]?.accountId || "");
  const [symbol, setSymbol] = useState("SPY");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [tif, setTif] = useState<TimeInForce>("day");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tradingMode, setTradingMode] = useState<TradingModeUi>("paper");
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [tracker, setTracker] = useState<{ clientOrderId: string; broker: typeof broker; accountId: string } | null>(
    null
  );
  const [signalContext, setSignalContext] = useState<OrderSignalContext | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/profile/trading-mode", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { trading_mode?: string };
        if (data.trading_mode === "live" || data.trading_mode === "paper") setTradingMode(data.trading_mode);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (!orderFromSignal?.symbol) {
      setSignalContext(null);
      return;
    }
    setSymbol(orderFromSignal.symbol);
    setSide(orderFromSignal.side);
    const ctx: OrderSignalContext = {};
    if (orderFromSignal.signal_id) ctx.signal_id = orderFromSignal.signal_id;
    if (typeof orderFromSignal.signal_strength === "number" && Number.isFinite(orderFromSignal.signal_strength)) {
      ctx.signal_strength = orderFromSignal.signal_strength;
    }
    if (typeof orderFromSignal.confluence_score === "number" && Number.isFinite(orderFromSignal.confluence_score)) {
      ctx.confluence_score = orderFromSignal.confluence_score;
    }
    if (orderFromSignal.pattern) ctx.pattern = orderFromSignal.pattern;
    if (orderFromSignal.signal_direction) ctx.signal_direction = orderFromSignal.signal_direction;
    setSignalContext(Object.values(ctx).some((v) => v != null && v !== "") ? ctx : null);
  }, [orderFromSignal]);

  const openConfirmation = useCallback(() => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const lim = limitPrice.trim() ? Number(limitPrice) : undefined;
    const stp = stopPrice.trim() ? Number(stopPrice) : undefined;
    const d: OrderDraft = {
      broker,
      accountId,
      symbol: symbol.trim().toUpperCase(),
      side,
      quantity: qty,
      orderType,
      timeInForce: tif,
      limitPrice: lim,
      stopPrice: stp,
      clientOrderId: `web-${Date.now()}`,
      availableCash: defaultAvailableCash,
      isDayTrade: true,
      signalContext: signalContext && Object.keys(signalContext).length ? signalContext : null
    };
    setDraft(d);
    setConfirmOpen(true);
  }, [accountId, broker, defaultAvailableCash, limitPrice, orderType, quantity, side, signalContext, stopPrice, symbol, tif]);

  return (
    <section
      className={surfaceGlowClassName}
      style={{ marginTop: 18, background: colors.surface, borderRadius: 12, padding: 16, border: `1px solid ${colors.border}` }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 style={{ margin: 0 }}>Order Entry</h2>
        <TradingModeBadge />
      </div>
      {tracker ? (
        <OrderStatusTracker
          broker={tracker.broker}
          accountId={tracker.accountId}
          clientOrderId={tracker.clientOrderId}
          onDone={() => setTracker(null)}
        />
      ) : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label>
            Broker
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={broker}
              onChange={(e) => setBroker(e.target.value as typeof broker)}
            >
              <option value="mock">mock</option>
              <option value="ibkr">ibkr</option>
              <option value="etrade">etrade</option>
            </select>
          </label>
          <label>
            Account
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {accountOptions.length === 0 ? (
                <option value="">No accounts available</option>
              ) : (
                accountOptions.map((option) => (
                  <option key={`${option.broker}-${option.accountId}`} value={option.accountId}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <label>
            Symbol
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </label>
          <label>
            Side
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            >
              <option value="buy">buy</option>
              <option value="sell">sell</option>
            </select>
          </label>
          <label>
            Quantity
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              type="number"
              min="0.0001"
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            Order Type
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
            >
              <option value="market">market</option>
              <option value="limit">limit</option>
              <option value="stop">stop</option>
              <option value="stop_limit">stop_limit</option>
            </select>
          </label>
          <label>
            Time in Force
            <select
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              value={tif}
              onChange={(e) => setTif(e.target.value as TimeInForce)}
            >
              <option value="day">day</option>
              <option value="gtc">gtc</option>
              <option value="ioc">ioc</option>
              <option value="fok">fok</option>
            </select>
          </label>
          <label>
            Limit Price
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
            />
          </label>
          <label>
            Stop Price
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              style={{ borderColor: colors.border, background: colors.background, color: colors.text }}
              type="number"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              type="button"
              className="min-h-11 w-full rounded-md px-3"
              style={{ background: colors.accent, color: "white", border: "none", borderRadius: borderRadius.md }}
              onClick={openConfirmation}
            >
              Place Order
            </button>
          </div>
        </div>
      )}
      <OrderConfirmationModal
        open={confirmOpen}
        draft={draft}
        tradingMode={tradingMode}
        onClose={() => setConfirmOpen(false)}
        onAccepted={(clientOrderId) => {
          setConfirmOpen(false);
          if (draft) {
            setTracker({ clientOrderId, broker: draft.broker, accountId: draft.accountId });
          }
        }}
      />
    </section>
  );
}

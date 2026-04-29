"use server";

import {
  placeBrokerOrder,
  type BrokerKind,
  type OrderType,
  type PlaceOrderPayload,
  type TimeInForce
} from "@/lib/api/brokers";

export interface OrderActionState {
  error?: string;
  success?: string;
}

const DEFAULT_STATE: OrderActionState = {};

function parsePositiveNumber(raw: FormDataEntryValue | null, fieldName: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return value;
}

export async function submitOrderAction(
  _prev: OrderActionState = DEFAULT_STATE,
  formData: FormData
): Promise<OrderActionState> {
  try {
    const broker = String(formData.get("broker") || "").trim() as BrokerKind;
    const accountId = String(formData.get("account_id") || "").trim();
    const symbol = String(formData.get("symbol") || "").trim().toUpperCase();
    const side = String(formData.get("side") || "").trim();
    const orderType = String(formData.get("order_type") || "").trim() as OrderType;
    const tif = String(formData.get("time_in_force") || "day").trim() as TimeInForce;
    const quantity = parsePositiveNumber(formData.get("quantity"), "Quantity");
    const limitRaw = String(formData.get("limit_price") || "").trim();
    const stopRaw = String(formData.get("stop_price") || "").trim();

    if (!broker || !["mock", "ibkr", "etrade"].includes(broker)) {
      return { error: "Broker must be one of mock/ibkr/etrade." };
    }
    if (!accountId) {
      return { error: "Account is required." };
    }
    if (!symbol) {
      return { error: "Symbol is required." };
    }
    if (!["buy", "sell"].includes(side)) {
      return { error: "Side must be buy or sell." };
    }

    const payload: PlaceOrderPayload = {
      symbol,
      side: side as "buy" | "sell",
      quantity,
      order_type: orderType,
      time_in_force: tif,
      client_order_id: `web-${Date.now()}`
    };

    if (limitRaw) {
      payload.limit_price = parsePositiveNumber(limitRaw, "Limit price");
    }
    if (stopRaw) {
      payload.stop_price = parsePositiveNumber(stopRaw, "Stop price");
    }

    const ack = await placeBrokerOrder(broker, accountId, payload);
    return {
      success: `Order accepted: ${ack.client_order_id}${ack.broker_order_id ? ` (${ack.broker_order_id})` : ""}`
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown order submission error.";
    return { error: message };
  }
}

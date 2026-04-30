import { apiFetch } from "@/lib/api/client";

export type BrokerKind = "mock" | "ibkr" | "etrade";

export interface BrokerHealthPayload {
  broker: BrokerKind;
  ok: boolean;
  message?: string | null;
}

export interface BrokerAccountPayload {
  account_id: string;
  display_name?: string | null;
}

export interface BrokerPositionPayload {
  symbol: string;
  quantity: number;
  avg_cost?: number | null;
}

export interface BrokerOverview {
  broker: BrokerKind;
  health?: BrokerHealthPayload;
  accounts?: BrokerAccountPayload[];
  positionsByAccount: Record<string, BrokerPositionPayload[]>;
  error?: string;
}

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export interface PlaceOrderPayload {
  symbol: string;
  side: OrderSide;
  quantity: number;
  order_type: OrderType;
  time_in_force: TimeInForce;
  client_order_id: string;
  limit_price?: number;
  stop_price?: number;
}

export interface OrderAckPayload {
  client_order_id: string;
  broker_order_id?: string | null;
}

export async function fetchBrokerOverview(broker: BrokerKind): Promise<BrokerOverview> {
  try {
    const payload = await apiFetch<{
      broker: BrokerKind;
      health: BrokerHealthPayload;
      accounts: BrokerAccountPayload[];
      positions_by_account: Record<string, BrokerPositionPayload[]>;
    }>(`/v1/brokers/overview?broker=${broker}`);
    if (!payload) {
      return {
        broker,
        positionsByAccount: {},
        error: "Service temporarily unavailable. Please try again."
      };
    }
    return {
      broker: payload.broker,
      health: payload.health,
      accounts: payload.accounts,
      positionsByAccount: payload.positions_by_account || {}
    };
  } catch (error: unknown) {
    return {
      broker,
      positionsByAccount: {},
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}

export async function fetchAllBrokerOverviews(): Promise<BrokerOverview[]> {
  const brokers: BrokerKind[] = ["mock", "ibkr", "etrade"];
  return Promise.all(brokers.map((broker) => fetchBrokerOverview(broker)));
}

export async function placeBrokerOrder(
  broker: BrokerKind,
  accountId: string,
  payload: PlaceOrderPayload
): Promise<OrderAckPayload> {
  const query = new URLSearchParams({ broker, account_id: accountId }).toString();
  const result = await apiFetch<OrderAckPayload>(`/v1/brokers/orders?${query}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (!result) {
    throw new Error("Service temporarily unavailable. Please try again.");
  }
  return result;
}

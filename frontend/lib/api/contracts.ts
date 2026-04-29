export interface HealthResponse {
  service: string;
  status: string;
  version: string;
  path: string;
}

export interface BrokerHealthResponse {
  broker: string;
  health: string;
}

export interface JournalEntryPayload {
  entry_id: string;
  user_id: string;
  symbol: string;
  opening_side: "buy" | "sell";
  quantity: number;
  opened_at: string;
  status: "open" | "closed" | "cancelled";
  strategy_tags: string[];
  is_day_trade: boolean;
  entry_notes?: string | null;
  closed_at?: string | null;
  exit_notes?: string | null;
  pnl_realized_usd?: number | null;
  broker_order_ids: string[];
}

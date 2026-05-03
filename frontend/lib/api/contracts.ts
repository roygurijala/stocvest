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

export interface UserMePayload {
  user_id: string;
  trading_mode: "paper" | "live";
  onboarding_completed: boolean;
  onboarding_completed_at?: string | null;
  legal_acknowledged: boolean;
  legal_acknowledged_at?: string | null;
  legal_acknowledged_version?: string | null;
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
  signal_id?: string | null;
  signal_direction?: string | null;
  signal_generated_at?: string | null;
  entry_price_avg?: number | null;
  exit_price_avg?: number | null;
  exit_order_id?: string | null;
  broker?: string | null;
  account_id?: string | null;
  setup_type?: string | null;
  signal_strength?: number | null;
  confluence_score?: number | null;
  outcome?: string | null;
  pnl_percent?: number | null;
  hold_duration_minutes?: number | null;
}

export interface CreateJournalEntryRequest {
  entry_id: string;
  symbol: string;
  opening_side: "buy" | "sell";
  quantity: number;
  is_day_trade: boolean;
  entry_notes?: string;
  strategy_tags?: string[];
  broker_order_ids?: string[];
}

export interface JournalAnalyticsPayload {
  user_id: string;
  total_trades: number;
  open_trades: number;
  win_rate: number;
  avg_winner_dollars: number;
  avg_loser_dollars: number;
  total_pnl_dollars: number;
  expectancy: number;
  current_streak: number;
  best_setup_type: string | null;
  worst_setup_type: string | null;
  best_setup_sample_size?: number;
  worst_setup_sample_size?: number;
  disclaimer: string;
}

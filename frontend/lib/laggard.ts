/**
 * Laggard intelligence — types and display config (swing composite + scanner API).
 */

export type LaggardType = "catch_up" | "pre_breakout" | "distribution";

export type DriverType =
  | "sector"
  | "index"
  | "theme"
  | "macro"
  | "pre_ipo_proxy"
  | "dynamic_cluster";

export type LaggardConfidence = "high" | "medium" | "low";

export interface LaggardPeerMove {
  symbol: string;
  move_1d: number;
  move_5d?: number;
  volume_ratio?: number;
}

export interface LaggardNarrative {
  summary_line?: string;
  explanation?: string;
  what_to_watch?: string;
}

export interface LaggardContextWire {
  sector_name?: string;
  group_type?: string;
  avg_peer_move_1d?: number;
  avg_peer_move_5d?: number;
  symbol_move_1d?: number;
  symbol_move_5d?: number;
  lag_behind_peers_1d?: number;
  lag_behind_peers_5d?: number;
  volume_pattern?: string;
  peers_moving?: LaggardPeerMove[];
}

export interface LaggardSignal {
  symbol: string;
  has_laggard_signal: boolean;
  laggard_type?: LaggardType;
  driver_type?: DriverType;
  driver_label?: string;
  trigger_entity?: string | null;
  confidence?: LaggardConfidence | string;
  laggard_score?: number;
  qualified_groups?: number;
  context?: LaggardContextWire;
  narrative?: LaggardNarrative;
  filters_passed?: Record<string, boolean>;
  reason?: string;
}

export interface UnlockHint {
  layer_name: string;
  layer_label: string;
  distance_description: string;
  trigger_condition: string;
  estimated_sessions: number | null;
  confidence: string;
  is_primary_blocker?: boolean;
}

export interface ScannerLaggardRow {
  symbol: string;
  laggard_type?: LaggardType;
  driver_type?: DriverType;
  driver_label?: string;
  confidence?: string;
  laggard_score?: number;
  summary_line?: string | null;
  current_watchlist_state?: string | null;
}

export interface ScannerLaggardsResponse {
  session_date?: string;
  scanned?: number;
  laggards_found?: number;
  laggards?: ScannerLaggardRow[];
}

export const LAGGARD_CONFIG: Record<
  LaggardType,
  {
    label: string;
    color: string;
    bgClass: string;
    textClass: string;
    isOpportunity: boolean;
  }
> = {
  catch_up: {
    label: "Catch-up",
    color: "#16a34a",
    bgClass: "rgba(34,197,94,0.12)",
    textClass: "#16a34a",
    isOpportunity: true
  },
  pre_breakout: {
    label: "Pre-breakout",
    color: "#d97706",
    bgClass: "rgba(245,158,11,0.12)",
    textClass: "#d97706",
    isOpportunity: true
  },
  distribution: {
    label: "Distribution",
    color: "#dc2626",
    bgClass: "rgba(239,68,68,0.12)",
    textClass: "#dc2626",
    isOpportunity: false
  }
};

export const DRIVER_CONFIG: Record<DriverType, { label: string; color: string; icon: string }> = {
  sector: { label: "Sector", color: "#d97706", icon: "◆" },
  index: { label: "Index", color: "#64748b", icon: "▣" },
  theme: { label: "Theme", color: "#7c3aed", icon: "◎" },
  macro: { label: "Macro", color: "#0ea5e9", icon: "↗" },
  pre_ipo_proxy: { label: "Pre-IPO proxy", color: "#9333ea", icon: "◇" },
  dynamic_cluster: { label: "Dynamic cluster", color: "#2563eb", icon: "✦" }
};

const LAGGARD_TYPES = new Set<string>(["catch_up", "pre_breakout", "distribution"]);
const DRIVER_TYPES = new Set<string>([
  "sector",
  "index",
  "theme",
  "macro",
  "pre_ipo_proxy",
  "dynamic_cluster"
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function parseLaggardSignal(raw: unknown): LaggardSignal | null {
  const o = asRecord(raw);
  if (!o) return null;
  const sym = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
  if (!sym) return null;
  const has = Boolean(o.has_laggard_signal);
  const lagType = typeof o.laggard_type === "string" && LAGGARD_TYPES.has(o.laggard_type) ? (o.laggard_type as LaggardType) : undefined;
  const driverType =
    typeof o.driver_type === "string" && DRIVER_TYPES.has(o.driver_type) ? (o.driver_type as DriverType) : undefined;

  let context: LaggardContextWire | undefined;
  const ctx = asRecord(o.context);
  if (ctx) {
    const peersRaw = ctx.peers_moving;
    const peers_moving: LaggardPeerMove[] = [];
    if (Array.isArray(peersRaw)) {
      for (const p of peersRaw) {
        const pr = asRecord(p);
        if (!pr || typeof pr.symbol !== "string") continue;
        const move1d = typeof pr.move_1d === "number" && Number.isFinite(pr.move_1d) ? pr.move_1d : null;
        if (move1d == null) continue;
        const row: LaggardPeerMove = { symbol: pr.symbol.trim().toUpperCase(), move_1d: move1d };
        if (typeof pr.move_5d === "number" && Number.isFinite(pr.move_5d)) row.move_5d = pr.move_5d;
        if (typeof pr.volume_ratio === "number" && Number.isFinite(pr.volume_ratio)) row.volume_ratio = pr.volume_ratio;
        peers_moving.push(row);
      }
    }
    context = {
      sector_name: typeof ctx.sector_name === "string" ? ctx.sector_name : undefined,
      group_type: typeof ctx.group_type === "string" ? ctx.group_type : undefined,
      avg_peer_move_1d: typeof ctx.avg_peer_move_1d === "number" ? ctx.avg_peer_move_1d : undefined,
      avg_peer_move_5d: typeof ctx.avg_peer_move_5d === "number" ? ctx.avg_peer_move_5d : undefined,
      symbol_move_1d: typeof ctx.symbol_move_1d === "number" ? ctx.symbol_move_1d : undefined,
      symbol_move_5d: typeof ctx.symbol_move_5d === "number" ? ctx.symbol_move_5d : undefined,
      lag_behind_peers_1d: typeof ctx.lag_behind_peers_1d === "number" ? ctx.lag_behind_peers_1d : undefined,
      lag_behind_peers_5d: typeof ctx.lag_behind_peers_5d === "number" ? ctx.lag_behind_peers_5d : undefined,
      volume_pattern: typeof ctx.volume_pattern === "string" ? ctx.volume_pattern : undefined,
      peers_moving: peers_moving.length ? peers_moving : undefined
    };
  }

  const narr = asRecord(o.narrative);
  const narrative: LaggardNarrative | undefined = narr
    ? {
        summary_line: typeof narr.summary_line === "string" ? narr.summary_line : undefined,
        explanation: typeof narr.explanation === "string" ? narr.explanation : undefined,
        what_to_watch: typeof narr.what_to_watch === "string" ? narr.what_to_watch : undefined
      }
    : undefined;

  return {
    symbol: sym,
    has_laggard_signal: has,
    laggard_type: lagType,
    driver_type: driverType,
    driver_label: typeof o.driver_label === "string" ? o.driver_label : undefined,
    trigger_entity: typeof o.trigger_entity === "string" ? o.trigger_entity : o.trigger_entity === null ? null : undefined,
    confidence: typeof o.confidence === "string" ? o.confidence : undefined,
    laggard_score: typeof o.laggard_score === "number" && Number.isFinite(o.laggard_score) ? o.laggard_score : undefined,
    qualified_groups: typeof o.qualified_groups === "number" ? o.qualified_groups : undefined,
    context,
    narrative,
    filters_passed: asRecord(o.filters_passed) ? (o.filters_passed as Record<string, boolean>) : undefined,
    reason: typeof o.reason === "string" ? o.reason : undefined
  };
}

export function parseUnlockForecast(raw: unknown): UnlockHint[] {
  if (!Array.isArray(raw)) return [];
  const out: UnlockHint[] = [];
  for (const item of raw) {
    const o = asRecord(item);
    if (!o || typeof o.layer_name !== "string" || typeof o.layer_label !== "string") continue;
    out.push({
      layer_name: o.layer_name,
      layer_label: o.layer_label,
      distance_description: typeof o.distance_description === "string" ? o.distance_description : "",
      trigger_condition: typeof o.trigger_condition === "string" ? o.trigger_condition : "",
      estimated_sessions:
        typeof o.estimated_sessions === "number" && Number.isFinite(o.estimated_sessions) ? o.estimated_sessions : null,
      confidence: typeof o.confidence === "string" ? o.confidence : "medium",
      is_primary_blocker: Boolean(o.is_primary_blocker)
    });
  }
  return out;
}

export function driverBadgeLabel(signal: LaggardSignal): string {
  if (signal.driver_label?.trim()) return signal.driver_label.trim();
  if (signal.driver_type && DRIVER_CONFIG[signal.driver_type]) {
    return DRIVER_CONFIG[signal.driver_type].label;
  }
  return "Peer group";
}

export function driverBadgeColor(driverType: DriverType | undefined): string {
  if (driverType && DRIVER_CONFIG[driverType]) return DRIVER_CONFIG[driverType].color;
  return "#d97706";
}

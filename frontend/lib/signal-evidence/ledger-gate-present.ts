/**
 * Layer 3 ledger gate summary from composite `gate_status` + `ledger_qualified`.
 */

export type LedgerGateRow = {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type LedgerGateSummary = {
  qualified: boolean | null;
  rows: LedgerGateRow[];
  headline: string;
};

const GATE_LABELS: Record<string, string> = {
  decision_state: "Decision state",
  market_environment: "Market environment",
  decision_score: "Composite score",
  alignment: "Layer alignment",
  macro_regime: "Macro regime",
  risk_reward: "Risk / reward",
  sector_layer: "Sector layer",
  intraday_depth: "Intraday depth",
  session_setup: "Session setup"
};

function gateDetail(key: string, g: Record<string, unknown>): string {
  if (key === "decision_state") {
    const need = g.need ?? "actionable";
    const val = g.value ?? "—";
    return `${String(val)} (need ${String(need)})`;
  }
  if (key === "market_environment") {
    const tier = g.tier != null ? String(g.tier) : "—";
    const reason = g.reason != null ? String(g.reason) : "";
    return reason ? `${tier} · ${reason}` : tier;
  }
  if (key === "risk_reward") {
    const v = g.value;
    const min = g.min;
    if (v == null) return String(g.reason ?? "missing");
    return `${v} (min ${min ?? "—"})`;
  }
  if (g.value != null) return String(g.value);
  if (g.bars != null) return `${g.bars} bars`;
  return "";
}

function parseGateRows(gates: Record<string, unknown>): LedgerGateRow[] {
  const rows: LedgerGateRow[] = [];
  for (const [key, raw] of Object.entries(gates)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.pass !== "boolean") continue;
    rows.push({
      key,
      label: GATE_LABELS[key] ?? key.replace(/_/g, " "),
      pass: g.pass,
      detail: gateDetail(key, g)
    });
  }
  const order = Object.keys(GATE_LABELS);
  rows.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return rows;
}

export function parseLedgerGateSummary(body: Record<string, unknown>): LedgerGateSummary | null {
  const gatesRaw = body.gate_status;
  if (!gatesRaw || typeof gatesRaw !== "object" || Array.isArray(gatesRaw)) return null;
  const rows = parseGateRows(gatesRaw as Record<string, unknown>);
  if (rows.length === 0) return null;

  const qualified =
    typeof body.ledger_qualified === "boolean"
      ? body.ledger_qualified
      : rows.every((r) => r.pass)
        ? true
        : rows.some((r) => !r.pass)
          ? false
          : null;

  const failed = rows.filter((r) => !r.pass);
  const headline =
    qualified === true
      ? "Validation ledger — all entry gates passed for this snapshot."
      : qualified === false
        ? `Validation ledger — blocked (${failed.map((r) => r.label).join(", ")}).`
        : "Validation ledger gate checklist for this snapshot.";

  return { qualified, rows, headline };
}

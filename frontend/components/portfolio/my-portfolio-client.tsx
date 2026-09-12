"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { fetchBffSnapshotsBatched, lookupSnapshot } from "@/lib/api/fetch-bff-snapshots";
import {
  deleteHoldingClient,
  fetchHoldingsClient,
  fetchPortfolioSettingsClient,
  savePortfolioSettingsClient,
  upsertHoldingClient
} from "@/lib/api/fetch-holdings-client";
import { buildPortfolioView, type PortfolioView } from "@/lib/portfolio/holdings-present";
import { PortfolioReviewPanel } from "@/components/portfolio/portfolio-review-panel";
import {
  DEFAULT_PORTFOLIO_SETTINGS,
  type Holding,
  type HoldingLot,
  type PortfolioSettings
} from "@/lib/portfolio/types";

function newLotId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `lot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtShares(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LotDraft {
  lotId: string;
  quantity: string;
  costBasis: string;
  purchaseDate: string;
  note: string;
}

interface HoldingDraft {
  symbol: string;
  lots: LotDraft[];
  existing: boolean;
}

function emptyLotDraft(): LotDraft {
  return { lotId: newLotId(), quantity: "", costBasis: "", purchaseDate: todayIso(), note: "" };
}

function draftFromHolding(h: Holding): HoldingDraft {
  return {
    symbol: h.symbol,
    existing: true,
    lots: h.lots.map((lot) => ({
      lotId: lot.lotId,
      quantity: String(lot.quantity),
      costBasis: String(lot.costBasis),
      purchaseDate: lot.purchaseDate,
      note: lot.note ?? ""
    }))
  };
}

export function MyPortfolioClient() {
  const { colors } = useTheme();

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [settings, setSettings] = useState<PortfolioSettings>({ ...DEFAULT_PORTFOLIO_SETTINGS });
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<HoldingDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Editable settings mirror (so typing doesn't fire saves).
  const [cashInput, setCashInput] = useState("0");
  const [targetInput, setTargetInput] = useState("");
  const [benchInput, setBenchInput] = useState("SPY");

  const reload = useCallback(async () => {
    setLoading(true);
    const [h, s] = await Promise.all([fetchHoldingsClient(), fetchPortfolioSettingsClient()]);
    setHoldings(h);
    setSettings(s);
    setCashInput(String(s.cashBalance ?? 0));
    setTargetInput(s.targetPositionPct != null ? String(s.targetPositionPct) : "");
    setBenchInput(s.benchmarkSymbol || "SPY");
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Fetch live quotes for held symbols + the benchmark.
  useEffect(() => {
    const symbols = [...holdings.map((h) => h.symbol), settings.benchmarkSymbol].filter(Boolean);
    if (symbols.length === 0) {
      setPrices(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const snaps = await fetchBffSnapshotsBatched(symbols);
      if (cancelled) return;
      const next = new Map<string, number | null>();
      for (const sym of symbols) {
        const snap = lookupSnapshot(snaps, sym);
        const price = snap?.last_trade_price ?? snap?.day_close ?? snap?.prev_close ?? null;
        next.set(sym.toUpperCase(), typeof price === "number" ? price : null);
      }
      setPrices(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [holdings, settings.benchmarkSymbol]);

  const view: PortfolioView = useMemo(
    () => buildPortfolioView(holdings, settings, (sym) => prices.get(sym.toUpperCase()) ?? null),
    [holdings, settings, prices]
  );

  const plColor = (n: number | null) =>
    n == null ? colors.textMuted : n > 0 ? colors.bullish : n < 0 ? colors.bearish : colors.textMuted;

  async function handleSaveSettings() {
    setSavingSettings(true);
    const cash = Number(cashInput);
    const target = targetInput.trim() === "" ? null : Number(targetInput);
    const payload: PortfolioSettings = {
      cashBalance: Number.isFinite(cash) && cash >= 0 ? cash : 0,
      targetPositionPct:
        target != null && Number.isFinite(target) && target > 0 && target <= 100 ? target : null,
      benchmarkSymbol: (benchInput.trim() || "SPY").toUpperCase()
    };
    const saved = await savePortfolioSettingsClient(payload);
    if (saved) setSettings(saved);
    setSavingSettings(false);
  }

  async function handleSaveHolding() {
    if (!draft) return;
    setFormError(null);
    const symbol = draft.symbol.trim().toUpperCase();
    if (!symbol) {
      setFormError("Enter a ticker symbol.");
      return;
    }
    const lots: HoldingLot[] = [];
    for (const l of draft.lots) {
      const quantity = Number(l.quantity);
      const costBasis = Number(l.costBasis);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setFormError("Each lot needs a quantity greater than 0.");
        return;
      }
      if (!Number.isFinite(costBasis) || costBasis < 0) {
        setFormError("Each lot needs a valid cost basis (price per share).");
        return;
      }
      if (!l.purchaseDate) {
        setFormError("Each lot needs a purchase date.");
        return;
      }
      lots.push({
        lotId: l.lotId || newLotId(),
        quantity,
        costBasis,
        purchaseDate: l.purchaseDate,
        note: l.note.trim() || undefined
      });
    }
    if (lots.length === 0) {
      setFormError("Add at least one lot.");
      return;
    }
    const saved = await upsertHoldingClient({ symbol, lots });
    if (!saved) {
      setFormError("Could not save. Check the values and try again.");
      return;
    }
    setDraft(null);
    await reload();
  }

  async function handleDelete(symbol: string) {
    const ok = await deleteHoldingClient(symbol);
    if (ok) await reload();
  }

  const benchPrice = prices.get(settings.benchmarkSymbol.toUpperCase());

  // ── styles ──────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    padding: spacing[4]
  };
  const th: React.CSSProperties = {
    textAlign: "right",
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.xs,
    color: colors.textMuted,
    fontWeight: 600,
    whiteSpace: "nowrap"
  };
  const td: React.CSSProperties = {
    textAlign: "right",
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.sm,
    color: colors.text,
    borderTop: `1px solid ${colors.border}`,
    whiteSpace: "nowrap"
  };
  const input: React.CSSProperties = {
    background: colors.background,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    color: colors.text,
    padding: `${spacing[1]} ${spacing[2]}`,
    fontSize: typography.scale.sm,
    width: "100%"
  };
  const btn = (kind: "primary" | "ghost" | "danger"): React.CSSProperties => ({
    background:
      kind === "primary" ? colors.accent : kind === "danger" ? "transparent" : "transparent",
    color: kind === "primary" ? "#fff" : kind === "danger" ? colors.bearish : colors.text,
    border: `1px solid ${kind === "primary" ? colors.accent : colors.border}`,
    borderRadius: borderRadius.md,
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typography.scale.sm,
    cursor: "pointer"
  });

  return (
    <div
      data-testid="my-portfolio"
      style={{ display: "flex", flexDirection: "column", gap: spacing[5], padding: spacing[4] }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <h1 style={{ fontSize: typography.scale.xl, color: colors.text, margin: 0 }}>My Portfolio</h1>
        <p style={{ fontSize: typography.scale.sm, color: colors.textMuted, margin: 0 }}>
          Your holdings, entered manually. STOCVEST reviews these for you — this is your personal
          workspace, not a broker link and not a trade order.
        </p>
      </header>

      {/* Summary strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: spacing[3]
        }}
      >
        <div style={card}>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Total value</div>
          <div style={{ fontSize: typography.scale.lg, color: colors.text, fontWeight: 700 }}>
            {fmtUsd(view.totalValue)}
          </div>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {fmtUsd(view.investedValue)} invested + {fmtUsd(view.cashBalance)} cash
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Unrealized P/L</div>
          <div style={{ fontSize: typography.scale.lg, color: plColor(view.unrealizedPl), fontWeight: 700 }}>
            {fmtUsd(view.unrealizedPl)}
          </div>
          <div style={{ fontSize: typography.scale.xs, color: plColor(view.unrealizedPl) }}>
            {fmtPct(view.unrealizedPlPct)}
            {view.fullyPriced ? "" : " · some prices unavailable"}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Cost basis</div>
          <div style={{ fontSize: typography.scale.lg, color: colors.text, fontWeight: 700 }}>
            {fmtUsd(view.investedCost)}
          </div>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {view.holdingsCount} holding{view.holdingsCount === 1 ? "" : "s"}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            Benchmark ({view.benchmarkSymbol})
          </div>
          <div style={{ fontSize: typography.scale.lg, color: colors.text, fontWeight: 700 }}>
            {typeof benchPrice === "number" ? fmtUsd(benchPrice) : "—"}
          </div>
          <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {view.targetPositionPct != null ? `Target ${view.targetPositionPct}% / position` : "No target set"}
          </div>
        </div>
      </div>

      {/* Daily review — the "manage my portfolio" read */}
      <PortfolioReviewPanel />

      {/* Settings */}
      <div style={card}>
        <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600, marginBottom: spacing[2] }}>
          Portfolio settings
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3], alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Cash balance ($)</span>
            <input
              data-testid="settings-cash"
              style={input}
              type="number"
              min={0}
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
              Target size (% per position)
            </span>
            <input
              data-testid="settings-target"
              style={input}
              type="number"
              min={0}
              max={100}
              placeholder="e.g. 5"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120 }}>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Benchmark</span>
            <input
              data-testid="settings-benchmark"
              style={input}
              value={benchInput}
              onChange={(e) => setBenchInput(e.target.value)}
            />
          </label>
          <button
            data-testid="settings-save"
            type="button"
            style={btn("primary")}
            disabled={savingSettings}
            onClick={() => void handleSaveSettings()}
          >
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>

      {/* Holdings table */}
      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: spacing[3]
          }}
        >
          <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>Holdings</div>
          <button
            data-testid="add-holding"
            type="button"
            style={btn("primary")}
            onClick={() => setDraft({ symbol: "", lots: [emptyLotDraft()], existing: false })}
          >
            + Add holding
          </button>
        </div>

        {loading ? (
          <div style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>Loading…</div>
        ) : view.rows.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
            No holdings yet. Add your first position to have STOCVEST manage it.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  <th style={th}>Qty</th>
                  <th style={th}>Avg cost</th>
                  <th style={th}>Price</th>
                  <th style={th}>Mkt value</th>
                  <th style={th}>Unreal. P/L</th>
                  <th style={th}>Weight</th>
                  <th style={{ ...th, textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.symbol} data-testid={`holding-row-${r.symbol}`}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>
                      {r.symbol}
                      <span style={{ color: colors.textMuted, fontWeight: 400 }}>
                        {r.lotCount > 1 ? ` · ${r.lotCount} lots` : ""}
                      </span>
                    </td>
                    <td style={td}>{fmtShares(r.quantity)}</td>
                    <td style={td}>{fmtUsd(r.averageCost)}</td>
                    <td style={td}>{fmtUsd(r.currentPrice)}</td>
                    <td style={td}>{fmtUsd(r.marketValue)}</td>
                    <td style={{ ...td, color: plColor(r.unrealizedPl) }}>
                      {fmtUsd(r.unrealizedPl)}
                      <span style={{ fontSize: typography.scale.xs }}> ({fmtPct(r.unrealizedPlPct)})</span>
                    </td>
                    <td style={td}>{r.weightPct != null ? `${r.weightPct.toFixed(1)}%` : "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        type="button"
                        style={{ ...btn("ghost"), marginRight: spacing[2] }}
                        onClick={() => {
                          const h = holdings.find((x) => x.symbol === r.symbol);
                          if (h) setDraft(draftFromHolding(h));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid={`delete-${r.symbol}`}
                        style={btn("danger")}
                        onClick={() => void handleDelete(r.symbol)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit form */}
      {draft ? (
        <div style={card} data-testid="holding-form">
          <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600, marginBottom: spacing[3] }}>
            {draft.existing ? `Edit ${draft.symbol}` : "Add holding"}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 200, marginBottom: spacing[3] }}>
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Ticker</span>
            <input
              data-testid="form-symbol"
              style={input}
              value={draft.symbol}
              disabled={draft.existing}
              placeholder="AAPL"
              onChange={(e) => setDraft({ ...draft, symbol: e.target.value })}
            />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
            {draft.lots.map((lot, i) => (
              <div
                key={lot.lotId}
                style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "flex-end" }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 110 }}>
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Shares</span>
                  <input
                    data-testid={`lot-qty-${i}`}
                    style={input}
                    type="number"
                    value={lot.quantity}
                    onChange={(e) => {
                      const lots = [...draft.lots];
                      lots[i] = { ...lot, quantity: e.target.value };
                      setDraft({ ...draft, lots });
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 130 }}>
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Buy price ($/sh)
                  </span>
                  <input
                    data-testid={`lot-cost-${i}`}
                    style={input}
                    type="number"
                    value={lot.costBasis}
                    onChange={(e) => {
                      const lots = [...draft.lots];
                      lots[i] = { ...lot, costBasis: e.target.value };
                      setDraft({ ...draft, lots });
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 150 }}>
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Purchase date</span>
                  <input
                    data-testid={`lot-date-${i}`}
                    style={input}
                    type="date"
                    value={lot.purchaseDate}
                    onChange={(e) => {
                      const lots = [...draft.lots];
                      lots[i] = { ...lot, purchaseDate: e.target.value };
                      setDraft({ ...draft, lots });
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 140 }}>
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Note (optional)</span>
                  <input
                    style={input}
                    value={lot.note}
                    onChange={(e) => {
                      const lots = [...draft.lots];
                      lots[i] = { ...lot, note: e.target.value };
                      setDraft({ ...draft, lots });
                    }}
                  />
                </label>
                {draft.lots.length > 1 ? (
                  <button
                    type="button"
                    style={btn("ghost")}
                    onClick={() => setDraft({ ...draft, lots: draft.lots.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <button
            type="button"
            style={{ ...btn("ghost"), marginTop: spacing[2] }}
            onClick={() => setDraft({ ...draft, lots: [...draft.lots, emptyLotDraft()] })}
          >
            + Add another lot
          </button>

          {formError ? (
            <div style={{ color: colors.bearish, fontSize: typography.scale.sm, marginTop: spacing[2] }}>
              {formError}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: spacing[2], marginTop: spacing[3] }}>
            <button data-testid="form-save" type="button" style={btn("primary")} onClick={() => void handleSaveHolding()}>
              Save holding
            </button>
            <button type="button" style={btn("ghost")} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

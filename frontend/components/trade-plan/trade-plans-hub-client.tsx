"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { TrackedPlanBadge } from "@/components/trade-plan/tracked-plan-badge";
import {
  exportTrackedPlansJson,
  importTrackedPlansJson,
  listTrackedPlans,
  removeTrackedPlan
} from "@/lib/trade-plan/tracked-plan-store";
import { dashboardDeepLinkForPlan } from "@/lib/trade-plan/plans-hub-deeplink";
import { formatCommittedEt, type LiveVsPlanDiff } from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";
import { useTrackedPlansList } from "@/lib/hooks/use-tracked-plans-list";
import { useTrackedPlansLiveAssessment } from "@/lib/hooks/use-tracked-plans-live-assessment";
import { pushTrackedPlanRemovalToServer, pushTrackedPlansSync } from "@/lib/trade-plan/tracked-plan-sync";
import { clearThesisSeenForPlan } from "@/lib/trade-plan/report-tracked-plan-thesis-alerts";
import type { SnapshotPayload } from "@/lib/api/market";

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtZone(lo: number, hi: number): string {
  return `${fmtUsd(lo)}–${fmtUsd(hi)}`;
}

async function fetchSnapshotsForSymbols(symbols: string[]): Promise<Map<string, SnapshotPayload>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return new Map();
  try {
    const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(uniq.join(","))}`, {
      cache: "no-store"
    });
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Record<string, SnapshotPayload> | SnapshotPayload[];
    if (Array.isArray(rows)) {
      const map = new Map<string, SnapshotPayload>();
      for (const row of rows) {
        const sym = row.symbol?.trim().toUpperCase();
        if (sym) map.set(sym, row);
      }
      return map;
    }
    const map = new Map<string, SnapshotPayload>();
    for (const [sym, row] of Object.entries(rows)) {
      map.set(sym.trim().toUpperCase(), row);
    }
    return map;
  } catch {
    return new Map();
  }
}

function PlanCard({
  plan,
  currentPrice,
  liveDiff,
  colors,
  onRemove
}: {
  plan: TrackedPlan;
  currentPrice: number | null;
  liveDiff?: LiveVsPlanDiff | null;
  colors: ReturnType<typeof useTheme>["colors"];
  onRemove: (id: string) => void;
}) {
  const lv = plan.levels;
  const priceTone =
    currentPrice == null
      ? colors.textMuted
      : currentPrice >= lv.entryLow && currentPrice <= lv.entryHigh
        ? colors.bullish
        : colors.textMuted;

  return (
    <article
      data-testid={`trade-plan-card-${plan.symbol}-${plan.mode}`}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        background: colors.surface,
        padding: spacing[4],
        display: "grid",
        gap: spacing[3]
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[3] }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
            <span style={{ fontSize: typography.scale.lg, fontWeight: 700, color: colors.text }}>{plan.symbol}</span>
            <span
              style={{
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: colors.textMuted,
                background: colors.surfaceMuted,
                borderRadius: borderRadius.full,
                padding: "2px 8px"
              }}
            >
              {plan.mode}
            </span>
            <TrackedPlanBadge colors={colors} />
          </div>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            Tracked {formatCommittedEt(plan.committedAt)} · {plan.bias}
          </span>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          {currentPrice != null ? (
            <>
              <div style={{ fontSize: typography.scale.sm, fontWeight: 600, color: priceTone }}>
                {fmtUsd(currentPrice)}
              </div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>Live</div>
            </>
          ) : (
            <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Price n/a</div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: spacing[2],
          fontSize: typography.scale.xs,
          lineHeight: 1.45,
          color: colors.text
        }}
      >
        <div>
          <div style={{ color: colors.textMuted, marginBottom: 2 }}>Entry zone</div>
          <div style={{ fontWeight: 600 }}>{fmtZone(lv.entryLow, lv.entryHigh)}</div>
        </div>
        <div>
          <div style={{ color: colors.textMuted, marginBottom: 2 }}>Stop</div>
          <div style={{ fontWeight: 600 }}>{fmtUsd(lv.stop)}</div>
        </div>
        <div>
          <div style={{ color: colors.textMuted, marginBottom: 2 }}>T1</div>
          <div style={{ fontWeight: 600 }}>{fmtUsd(lv.target1)}</div>
        </div>
        {lv.riskRewardAtCommit != null ? (
          <div>
            <div style={{ color: colors.textMuted, marginBottom: 2 }}>R/R at commit</div>
            <div style={{ fontWeight: 600 }}>{lv.riskRewardAtCommit.toFixed(1)}:1</div>
          </div>
        ) : null}
      </div>

      {plan.verdictLine ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
          {plan.verdictLine}
        </p>
      ) : null}

      {liveDiff ? (
        <div
          data-testid={`trade-plan-live-read-${plan.symbol}-${plan.mode}`}
          style={{
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[2],
            display: "grid",
            gap: 4,
            fontSize: typography.scale.xs
          }}
        >
          <span
            style={{
              fontWeight: 700,
              color:
                liveDiff.thesis.status === "valid"
                  ? colors.bullish
                  : liveDiff.thesis.status === "weakened"
                    ? colors.caution
                    : colors.bearish
            }}
          >
            {liveDiff.thesis.label}
          </span>
          <span style={{ color: colors.textMuted, lineHeight: 1.45 }}>{liveDiff.thesis.hint}</span>
          <span style={{ fontWeight: 600, color: colors.text }}>{liveDiff.trigger.label}</span>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        <Link
          href={dashboardDeepLinkForPlan(plan.symbol, plan.mode)}
          data-testid={`trade-plan-open-${plan.symbol}-${plan.mode}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 14px",
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.accent}`,
            background: `${colors.accent}14`,
            color: colors.accent,
            fontSize: typography.scale.xs,
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Open in Trading Room
        </Link>
        <button
          type="button"
          onClick={() => onRemove(plan.id)}
          data-testid={`trade-plan-remove-${plan.symbol}-${plan.mode}`}
          style={{
            padding: "8px 14px",
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceMuted,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

export function TradePlansHubClient() {
  const { colors } = useTheme();
  const { plans, refresh, syncing } = useTrackedPlansList();
  const { diffByPlanId, loading: assessing } = useTrackedPlansLiveAssessment(plans);
  const [pricesBySymbol, setPricesBySymbol] = useState<Map<string, number>>(new Map());
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  usePublishAssistantContext({ page: "dashboard/plans" });

  const symbols = useMemo(() => plans.map((p) => p.symbol), [plans]);

  const loadPrices = useCallback(async () => {
    const snaps = await fetchSnapshotsForSymbols(symbols);
    const next = new Map<string, number>();
    for (const [sym, snap] of snaps) {
      const px = snap.last_trade_price ?? snap.day_close ?? snap.prev_close;
      if (typeof px === "number" && Number.isFinite(px)) next.set(sym, px);
    }
    setPricesBySymbol(next);
  }, [symbols]);

  useEffect(() => {
    void loadPrices();
  }, [loadPrices]);

  const handleExport = () => {
    const blob = new Blob([exportTrackedPlansJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stocvest-trade-plans-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const result = importTrackedPlansJson(text);
    if (result.error) {
      setImportMessage(result.error);
    } else {
      setImportMessage(`Imported ${result.imported} plan${result.imported === 1 ? "" : "s"}.`);
      refresh();
      void pushTrackedPlansSync(listTrackedPlans());
    }
  };

  const handleRemove = (id: string) => {
    removeTrackedPlan(id);
    clearThesisSeenForPlan(id);
    refresh();
    void pushTrackedPlanRemovalToServer(id);
  };

  return (
    <section style={{ display: "grid", gap: spacing[4] }} data-testid="trade-plans-hub">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Trade plans
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          Frozen entry, stop, and target levels you committed to from Deep Dive or Scenario Builder. Live desk scans
          update separately — they do not rewrite a tracked plan.
          {syncing || assessing ? (
            <span style={{ display: "block", marginTop: 6, fontSize: typography.scale.xs }}>
              {syncing ? "Syncing plans…" : "Refreshing live reads…"}
            </span>
          ) : null}
        </p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <button
          type="button"
          onClick={handleExport}
          disabled={plans.length === 0}
          data-testid="trade-plans-export"
          style={{
            padding: "8px 14px",
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: plans.length === 0 ? "not-allowed" : "pointer",
            opacity: plans.length === 0 ? 0.5 : 1
          }}
        >
          Export backup
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="trade-plans-import"
          style={{
            padding: "8px 14px",
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Import backup
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
        {importMessage ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{importMessage}</span>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <div
          data-testid="trade-plans-empty"
          style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: borderRadius.md,
            padding: spacing[5],
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            lineHeight: 1.5
          }}
        >
          No tracked plans yet. Open a symbol in the{" "}
          <Link href="/dashboard" className="font-medium hover:underline" style={{ color: colors.accent }}>
            Trading Room
          </Link>
          , review the setup in Deep Dive, and choose <strong>Track plan</strong> to freeze your levels.
        </div>
      ) : (
        <div style={{ display: "grid", gap: spacing[3] }}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPrice={pricesBySymbol.get(plan.symbol) ?? null}
              liveDiff={diffByPlanId.get(plan.id) ?? null}
              colors={colors}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

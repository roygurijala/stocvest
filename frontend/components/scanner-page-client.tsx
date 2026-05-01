"use client";

import { useMemo, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import { CONFIDENCE_PERCENT_TIP, GAP_CANDIDATES_TIP, SETUP_RELATIVE_VOLUME_TIP } from "@/lib/ui-tooltips";
import { InfoTip } from "@/components/info-tip";

interface ScannerPageClientProps {
  initialOverview: ScannerOverview;
  initialTimestampIso: string;
}

function scoreColor(score: number, colors: ThemeColors): string {
  if (score >= 0.65) return colors.bullish;
  if (score <= 0.35) return colors.bearish;
  return colors.caution;
}

export function ScannerPageClient({ initialOverview, initialTimestampIso }: ScannerPageClientProps) {
  const { colors } = useTheme();
  const [isPending, startTransition] = useTransition();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const router = useRouter();

  const gapMaxVolume = useMemo(
    () => Math.max(1, ...initialOverview.gaps.map((g) => g.day_volume || 0)),
    [initialOverview.gaps]
  );

  const gapMaxAbsPct = useMemo(
    () => Math.max(1, ...initialOverview.gaps.map((g) => Math.abs(g.gap_percent || 0))),
    [initialOverview.gaps]
  );

  const dayVolBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of initialOverview.gaps) {
      m.set(g.symbol, g.day_volume || 0);
    }
    return m;
  }, [initialOverview.gaps]);

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[3] }}>
        <p style={{ margin: 0, color: colors.textMuted }}>
          Last scan: {new Date(initialTimestampIso).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              router.refresh();
            })
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surface,
            color: colors.text,
            padding: `${spacing[2]} ${spacing[3]}`,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={14} style={{ animation: isPending ? "spin 1s linear infinite" : undefined }} />
          {isPending ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="scanner-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: spacing[3] }}>
        <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            Gap Candidates
            <InfoTip text={GAP_CANDIDATES_TIP} label="About gap candidates" />
          </h3>
          <div style={{ display: "grid", gap: spacing[3] }}>
            {initialOverview.gaps.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No gap candidates right now.</p>
            ) : (
              initialOverview.gaps.map((gap, idx) => (
                <motion.article
                  key={`${gap.symbol}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                    <strong>{gap.symbol}</strong>
                    <span
                      style={{
                        borderRadius: borderRadius.full,
                        padding: "2px 8px",
                        background: "rgba(59,130,246,0.14)",
                        color: colors.accent,
                        fontSize: typography.scale.xs
                      }}
                    >
                      {gap.gap_percent > 0 ? "+" : ""}
                      {gap.gap_percent.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ marginTop: spacing[2], display: "grid", gap: spacing[2] }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: spacing[2],
                        fontSize: typography.scale.xs,
                        color: colors.textMuted
                      }}
                    >
                      <span>Prev close</span>
                      <span style={{ color: gap.gap_percent >= 0 ? colors.bullish : colors.bearish, fontSize: 14 }}>
                        {gap.gap_percent >= 0 ? "→" : "←"}
                      </span>
                      <span>Today / gap</span>
                    </div>
                    <div style={{ height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, (Math.abs(gap.gap_percent) / gapMaxAbsPct) * 100)}%`,
                          marginLeft: gap.gap_percent < 0 ? "auto" : 0,
                          borderRadius: borderRadius.full,
                          background: gap.gap_percent >= 0 ? colors.bullish : colors.bearish,
                          minWidth: "8%"
                        }}
                      />
                    </div>
                    <div style={{ height: 6, background: colors.surfaceMuted, borderRadius: borderRadius.full }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(8, (gap.day_volume / gapMaxVolume) * 100)}%`,
                          borderRadius: borderRadius.full,
                          background: colors.accent
                        }}
                      />
                    </div>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                      Vol {(gap.day_volume || 0).toLocaleString()}
                    </p>
                  </div>
                </motion.article>
              ))
            )}
          </div>
        </section>

        <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0 }}>News Catalysts</h3>
          <div style={{ display: "grid", gap: spacing[3] }}>
            {initialOverview.catalysts.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No catalysts right now.</p>
            ) : (
              initialOverview.catalysts.map((c, idx) => (
                <motion.article
                  key={`${c.article_id}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                    <strong>{c.symbol}</strong>
                    <span style={{ color: scoreColor(c.catalyst_score, colors), fontSize: typography.scale.xs }}>
                      {Math.round(c.catalyst_score * 100)}
                    </span>
                  </div>
                  <p style={{ margin: `${spacing[1]} 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                    <span
                      style={{
                        background: "rgba(59,130,246,0.12)",
                        color: colors.accent,
                        borderRadius: borderRadius.full,
                        padding: "2px 8px"
                      }}
                    >
                      {c.catalyst_type}
                    </span>
                  </p>
                  <p style={{ margin: 0, fontSize: typography.scale.sm }}>
                    {c.title.length > 90 ? `${c.title.slice(0, 87)}...` : c.title}
                  </p>
                </motion.article>
              ))
            )}
          </div>
        </section>

        <section style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}>
          <h3 style={{ marginTop: 0 }}>Intraday Setups</h3>
          <div style={{ display: "grid", gap: spacing[3] }}>
            {initialOverview.setups.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No setups right now.</p>
            ) : (
              initialOverview.setups.map((setup, idx) => (
                <motion.article
                  key={`${setup.symbol}-${setup.timestamp_iso}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  style={{ border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg, padding: spacing[3] }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                    <strong>{setup.symbol}</strong>
                    <span
                      style={{
                        borderRadius: borderRadius.full,
                        padding: "2px 8px",
                        background:
                          ["bullish", "long"].includes(setup.direction.toLowerCase()) ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)",
                        color: ["bullish", "long"].includes(setup.direction.toLowerCase()) ? colors.bullish : colors.bearish,
                        fontSize: typography.scale.xs
                      }}
                    >
                      {setup.direction}
                    </span>
                  </div>
                  <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.sm, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    Confidence {Math.round(setup.score * 100)}%
                    <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About confidence" />
                  </p>
                  <p style={{ margin: `${spacing[1]} 0`, color: colors.textMuted, fontSize: typography.scale.xs }}>
                    {setup.triggers[0] || "Intraday pattern"}
                  </p>
                  {(() => {
                    const dv = dayVolBySymbol.get(setup.symbol);
                    const ratio =
                      dv != null && gapMaxVolume > 0
                        ? Math.min(3.5, Math.max(0.35, dv / (gapMaxVolume / 2.2)))
                        : 0.85 + setup.score * 2.2;
                    const fillPct = Math.min(100, (ratio / 3.5) * 100);
                    const d = setup.direction.toLowerCase();
                    const up = d === "long" || d === "bullish";
                    return (
                      <div style={{ marginTop: spacing[2] }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Volume vs batch</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: typography.scale.xs, color: colors.textMuted }}>
                            {ratio.toFixed(1)}x avg
                            <InfoTip text={SETUP_RELATIVE_VOLUME_TIP} label="Relative volume" />
                          </span>
                        </div>
                        <div style={{ height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${fillPct}%`,
                              borderRadius: borderRadius.full,
                              background: up ? colors.bullish : colors.bearish,
                              opacity: 0.92
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setSelectedSymbol(setup.symbol)}
                    style={{
                      marginTop: spacing[2],
                      border: `1px solid ${colors.accent}`,
                      borderRadius: borderRadius.md,
                      background: "rgba(59,130,246,0.15)",
                      color: colors.accent,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      cursor: "pointer",
                      fontSize: typography.scale.xs
                    }}
                  >
                    Trade This Setup
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
                      try {
                        symbolNewsArticles = await fetchSymbolNews(setup.symbol, 10);
                      } catch {
                        symbolNewsArticles = [];
                      }
                      setEvidence(buildEvidenceFromSetup(setup, undefined, { symbolNewsArticles }));
                      setEvidenceOpen(true);
                    }}
                    style={{
                      marginTop: spacing[2],
                      marginLeft: spacing[2],
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      background: "transparent",
                      color: colors.text,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      cursor: "pointer",
                      fontSize: typography.scale.xs
                    }}
                  >
                    View Evidence
                  </button>
                </motion.article>
              ))
            )}
          </div>
        </section>
      </div>

      {selectedSymbol ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 60
          }}
        >
          <div style={{ width: "min(460px, 92vw)", background: colors.surface, borderRadius: borderRadius.xl, padding: spacing[5] }}>
            <h3 style={{ marginTop: 0 }}>Order modal placeholder</h3>
            <p style={{ margin: `${spacing[2]} 0`, color: colors.textMuted }}>
              Trade flow for <strong>{selectedSymbol}</strong> will be wired in a later phase.
            </p>
            <button
              type="button"
              onClick={() => setSelectedSymbol(null)}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                background: "transparent",
                color: colors.text,
                padding: `${spacing[2]} ${spacing[3]}`,
                cursor: "pointer"
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}

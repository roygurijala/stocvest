"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  formatLayerForceNames,
  groupLayersByForce,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  rows: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  /** Evidence card omits level-score footnote (verdict-only surface). */
  showLevelFootnote?: boolean;
};

export function SignalsLayerForceSummary({ rows, bias, showLevelFootnote = true }: Props) {
  const { colors } = useTheme();
  const groups = groupLayersByForce(rows, bias);
  const hasForces =
    groups.withBias.length > 0 || groups.againstOrMixed.length > 0 || groups.noEdge.length > 0;

  if (!hasForces) return null;

  return (
    <motion.div
      className="mt-4 grid gap-3 sm:grid-cols-2"
      data-testid="signals-layer-force-summary"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: `linear-gradient(135deg, ${colors.surface}80, ${colors.surfaceMuted}40)`,
        padding: spacing[4],
        boxShadow: `0 4px 16px -4px ${colors.border}30, inset 0 1px 0 ${colors.surface}60`
      }}
    >
      <ForceColumn
        title={groups.titles.withBias}
        names={formatLayerForceNames(groups.withBias)}
        tone="support"
        colors={colors}
        testId="signals-layer-force-with-bias"
        count={groups.withBias.length}
      />
      <ForceColumn
        title={groups.titles.againstOrMixed}
        names={formatLayerForceNames(groups.againstOrMixed)}
        tone="oppose"
        colors={colors}
        testId="signals-layer-force-against"
        count={groups.againstOrMixed.length}
      />
      {groups.noEdge.length > 0 ? (
        <div className="sm:col-span-2">
          <ForceColumn
            title={groups.titles.noEdge}
            names={formatLayerForceNames(groups.noEdge)}
            tone="muted"
            colors={colors}
            testId="signals-layer-force-neutral"
            count={groups.noEdge.length}
          />
        </div>
      ) : null}
      {showLevelFootnote ? (
        <p className="m-0 sm:col-span-2 text-[11px] leading-relaxed mt-2 pt-2 border-t" 
           style={{ color: colors.textMuted, borderColor: `${colors.border}40` }}>
          Level scores show today&apos;s layer read, not how much each layer weighs in the composite.
          Structure and breadth usually matter more than a single headline.
        </p>
      ) : null}
    </motion.div>
  );
}

function ForceColumn({
  title,
  names,
  tone,
  colors,
  testId,
  count
}: {
  title: string;
  names: string;
  tone: "support" | "oppose" | "muted";
  colors: ReturnType<typeof useTheme>["colors"];
  testId: string;
  count: number;
}) {
  const accent =
    tone === "support" ? colors.bullish : tone === "oppose" ? colors.caution : colors.textMuted;
  
  const Icon = tone === "support" ? TrendingUp : tone === "oppose" ? TrendingDown : Minus;

  return (
    <motion.div 
      data-testid={testId}
      className="flex items-start gap-3 p-2 rounded-lg"
      style={{
        background: `${accent}08`,
        border: `1px solid ${accent}20`
      }}
      whileHover={{ background: `${accent}12` }}
    >
      <div 
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ 
          background: `${accent}20`,
          border: `1px solid ${accent}30`
        }}
      >
        <Icon className="w-4 h-4" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="m-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>
            {title}
          </p>
          <span 
            className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
            style={{ 
              background: `${accent}25`,
              color: accent,
              minWidth: '1.25rem'
            }}
          >
            {count}
          </span>
        </div>
        <p className="m-0 mt-1 text-sm font-medium leading-snug" style={{ color: colors.text }}>
          {names || "None"}
        </p>
      </div>
    </motion.div>
  );
}

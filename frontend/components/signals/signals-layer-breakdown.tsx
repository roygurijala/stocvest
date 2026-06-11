"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronDown, 
  ChevronUp, 
  ChevronRight,
  X,
  TrendingUp, 
  TrendingDown, 
  Activity,
  Zap,
  Globe,
  Newspaper,
  BarChart3,
  Cpu,
  Info,
  Target,
  Scale,
  FileText,
  Building2,
  AlertTriangle,
  Calendar,
  Newspaper as NewsIcon,
  TrendingUp as MomentumIcon,
  Users
} from "lucide-react";
import { CuteLoader } from "@/components/cute-loader";
import { InfoTip } from "@/components/info-tip";
import { LAYER_NAME_HINTS, SIGNAL_LAYER_LEVEL_VS_DELTA_TIP } from "@/lib/ui-tooltips";
import { SignalsLayerForceSummary } from "@/components/signals/signals-layer-force-summary";
import { causalLineForLayerRow, type CausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import {
  buildLayerInsightLine,
  buildLayerRoleHeadline,
  layerHasCustomInsight,
  formatDeltaVsBaselineShort,
  formatLayerScoreLabel,
  formatSignalsAlignmentDisplayLine,
  resolveSignalsLayerAlignment,
  layerPolarity,
  layerPolarityDotColor,
  layerRoleLabel,
  pickCollapsedLayerPreview,
  SIGNAL_LAYER_LEVEL_BASELINE,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

// Layer icon mapping
const LAYER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  technical: BarChart3,
  news: Newspaper,
  macro: Globe,
  sector: Cpu,
  geopolitical: Activity,
  internals: Zap,
};

type Props = {
  symbol: string;
  tradingMode: "day" | "swing";
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  loading: boolean;
  insufficient: boolean;
  insufficientMessage?: ReactNode;
  maturationState?: string | null;
  alignmentRatio?: number | null;
  /** Layers tab: show all rows without collapse affordance. */
  defaultExpanded?: boolean;
  causalNarrative?: CausalNarrative | null;
};

export function SignalsLayerBreakdown({
  symbol,
  tradingMode,
  bias,
  rows,
  loading,
  insufficient,
  insufficientMessage,
  maturationState,
  alignmentRatio,
  defaultExpanded = false,
  causalNarrative = null
}: Props) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selectedLayer, setSelectedLayer] = useState<SignalsLayerRowInput | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleLayerClick = (row: SignalsLayerRowInput) => {
    setSelectedLayer(row);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setTimeout(() => setSelectedLayer(null), 300);
  };
  const alignment = resolveSignalsLayerAlignment({ rows, bias, alignmentRatio });
  const preview = pickCollapsedLayerPreview(rows, bias, 2, 2);
  const visible = expanded ? rows : preview.length > 0 ? preview : rows.slice(0, 3);

  return (
    <>
      <motion.section
        id="signals-layers"
        className={`signals-snap-section scroll-mt-4 ${surfaceGlowClassName}`}
        data-testid="signals-layer-breakdown"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background: `linear-gradient(135deg, ${colors.surface} 0%, ${colors.surfaceMuted}50 100%)`,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          padding: spacing[6],
          boxShadow: `0 8px 32px -12px ${colors.border}40, inset 0 1px 0 ${colors.surface}80`,
          position: "relative",
          overflow: "hidden"
        }}
      >
      {/* Background glow effect */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% -20%, ${colors.accent}15, transparent)`,
        }}
      />
      
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div 
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${colors.accent}20, ${colors.accent}05)`,
                border: `1px solid ${colors.accent}30`,
                boxShadow: `0 4px 12px -4px ${colors.accent}40`
              }}
            >
              <div style={{ color: colors.accent }}>
                <Activity className="w-5 h-5" />
              </div>
            </div>
            <div>
              <h3 
                className="m-0 font-bold tracking-tight"
                style={{ 
                  fontSize: typography.scale.xl,
                  background: `linear-gradient(135deg, ${colors.text}, ${colors.textMuted})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent"
                }}
              >
                Signal Layers
              </h3>
              <span className="text-xs font-medium" style={{ color: colors.textMuted }}>
                6-Dimensional Analysis
              </span>
            </div>
          </div>
          
          <div 
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ 
              background: `${colors.surfaceMuted}80`,
              border: `1px solid ${colors.border}`,
              color: colors.textMuted
            }}
          >
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: colors.accent }} />
            Live • 0–100 Scale
            <InfoTip text={SIGNAL_LAYER_LEVEL_VS_DELTA_TIP} label="Level vs Δ" maxWidth={320} />
          </div>
        </div>
        
        <p className="m-0 text-sm mb-4" style={{ color: colors.textMuted }}>
          {formatSignalsAlignmentDisplayLine(alignment, bias, maturationState)}
        </p>
      </div>

      {loading ? (
        <div style={{ padding: `${spacing[6]} ${spacing[2]}` }} data-testid="signals-layers-loader">
          <CuteLoader
            label={`Loading ${tradingMode === "swing" ? "swing" : "day"} signal`}
            sublabel={`Refreshing layers for ${symbol.trim().toUpperCase()}.`}
            compact
          />
        </div>
      ) : insufficient ? (
        insufficientMessage
      ) : (
        <>
          <SignalsLayerForceSummary rows={rows} bias={bias} />
          <div className="mt-5 space-y-3">
            <AnimatePresence mode="popLayout">
              {visible.map((row, index) => (
                <motion.div
                  key={row.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ 
                    duration: 0.4, 
                    delay: index * 0.08,
                    ease: [0.22, 1, 0.36, 1]
                  }}
                >
                  <LayerRow
                    row={row}
                    bias={bias}
                    colors={colors}
                    causalNarrative={causalNarrative}
                    onClick={() => handleLayerClick(row)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {!defaultExpanded && rows.length > preview.length ? (
            <button
              type="button"
              className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium"
              style={{ border: `1px solid ${colors.border}`, color: colors.textMuted, background: colors.surfaceMuted }}
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
              data-testid="signals-layers-expand"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} aria-hidden />
                  Show fewer layers
                </>
              ) : (
                <>
                  <ChevronDown size={14} aria-hidden />
                  View all layers
                </>
              )}
            </button>
          ) : null}
        </>
      )}
    </motion.section>
    
    {/* Layer Detail Drawer */}
    <LayerDetailDrawer
      isOpen={isDrawerOpen}
      onClose={handleCloseDrawer}
      layer={selectedLayer}
      bias={bias}
      colors={colors}
      symbol={symbol}
    />
    </>
  );
}

function LayerRow({
  row,
  bias,
  colors,
  causalNarrative,
  onClick
}: {
  row: SignalsLayerRowInput;
  bias: SignalsSetupBias;
  colors: ReturnType<typeof useTheme>["colors"];
  causalNarrative: CausalNarrative | null;
  onClick?: () => void;
}) {
  const polarity = layerPolarity(row, bias);
  const dot = layerPolarityDotColor(polarity);
  const roleHeadline = buildLayerRoleHeadline(row, bias);
  const causalLine = causalLineForLayerRow(row, causalNarrative, bias);
  const insight = causalLine ?? buildLayerInsightLine(row, bias);
  const showInsight = Boolean(causalLine) || layerHasCustomInsight(row);
  const hint = LAYER_NAME_HINTS[row.key as keyof typeof LAYER_NAME_HINTS];
  const levelLabel = formatLayerScoreLabel(row.score, row.status);
  const showLevel = row.score != null && levelLabel !== "N/A" && levelLabel !== "—";
  const levelPct = showLevel ? Math.max(0, Math.min(100, Number(levelLabel))) : 0;
  const delta =
    typeof row.deltaVsBaseline === "number" && Number.isFinite(row.deltaVsBaseline)
      ? row.deltaVsBaseline
      : null;

  // Get icon for this layer
  const IconComponent = LAYER_ICONS[row.key] || Activity;
  
  // Determine trend icon based on polarity
  const polarityStr = String(polarity);
  const TrendIcon = polarityStr === "with" ? TrendingUp : polarityStr === "against" ? TrendingDown : Activity;
  
  // Gradient colors based on score
  const getScoreGradient = (score: number) => {
    if (score >= 70) return `linear-gradient(90deg, ${colors.bullish}, ${colors.bullish}80)`;
    if (score >= 50) return `linear-gradient(90deg, ${colors.accent}, ${colors.accent}80)`;
    if (score >= 30) return `linear-gradient(90deg, ${colors.caution}, ${colors.caution}80)`;
    return `linear-gradient(90deg, ${colors.bearish}, ${colors.bearish}80)`;
  };

  return (
    <motion.div
      className="group relative overflow-hidden rounded-xl cursor-pointer"
      style={{ 
        background: `linear-gradient(135deg, ${colors.surface}90, ${colors.surfaceMuted}60)`,
        border: `1px solid ${colors.border}`,
        boxShadow: `0 2px 8px -2px ${colors.border}30, inset 0 1px 0 ${colors.surface}50`
      }}
      whileHover={{ 
        scale: 1.01,
        boxShadow: `0 8px 24px -4px ${colors.border}50, inset 0 1px 0 ${colors.surface}80`
      }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      data-testid={`signals-layer-row-${row.key}`}
      data-layer-polarity={polarity}
    >
      {/* Click hint */}
      {onClick && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-4 h-4" style={{ color: colors.textMuted }} />
        </div>
      )}
      {/* Animated border glow on hover */}
      <div 
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `linear-gradient(90deg, ${dot}20, transparent, ${dot}20)`,
          backgroundSize: '200% 100%',
        }}
      />
      
      <div className="relative z-10 p-4">
        <div className="flex items-start gap-3">
          {/* Icon with gradient background */}
          <div 
            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${dot}25, ${dot}05)`,
              border: `1px solid ${dot}40`,
              boxShadow: `0 4px 12px -4px ${dot}50`
            }}
          >
            <div style={{ color: dot }}>
              <IconComponent className="w-5 h-5" />
            </div>
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Company name if available */}
            {row.companyName && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <Building2 className="w-3 h-3" style={{ color: colors.textMuted }} />
                <span className="text-xs font-medium" style={{ color: colors.textMuted }}>
                  {row.companyName}
                </span>
              </div>
            )}
            
            <div className="flex items-center gap-2 flex-wrap">
              <span 
                className="text-sm font-bold tracking-tight"
                style={{ color: colors.text }}
              >
                {row.name}
              </span>
              
              {/* Status badge */}
              {row.statusLabel && (
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                  style={{ 
                    background: `${dot}15`,
                    color: dot,
                    border: `1px solid ${dot}30`
                  }}
                >
                  {row.statusLabel}
                </span>
              )}
              
              {hint ? <InfoTip text={hint} label={row.name} /> : null}
            </div>
            
            {/* Role headline with trend indicator */}
            <div className="flex items-center gap-2 mt-1">
              <div style={{ color: dot }}>
                <TrendIcon className="w-3.5 h-3.5" />
              </div>
              <p className="m-0 text-sm font-medium" style={{ color: colors.text }}>
                {roleHeadline}
              </p>
            </div>
            
            {/* Score bar with animation */}
            {showLevel ? (
              <div className="mt-3" data-testid={`signals-layer-level-${row.key}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span 
                      className="text-lg font-bold tabular-nums"
                      style={{ 
                        color: levelPct >= 60 ? colors.bullish : levelPct >= 40 ? colors.accent : colors.caution,
                        textShadow: `0 0 20px ${levelPct >= 60 ? colors.bullish : levelPct >= 40 ? colors.accent : colors.caution}30`
                      }}
                    >
                      {levelLabel}
                    </span>
                    <span className="text-xs font-medium" style={{ color: colors.textMuted }}>
                      /100
                    </span>
                  </div>
                  
                  {delta != null && (
                    <span
                      className="text-xs font-medium tabular-nums px-2 py-0.5 rounded-full"
                      style={{ 
                        color: delta >= 0 ? colors.bullish : colors.bearish,
                        background: delta >= 0 ? `${colors.bullish}15` : `${colors.bearish}15`,
                        border: `1px solid ${delta >= 0 ? colors.bullish : colors.bearish}30`
                      }}
                      data-testid={`signals-layer-delta-${row.key}`}
                    >
                      {formatDeltaVsBaselineShort(delta)} vs {SIGNAL_LAYER_LEVEL_BASELINE}
                    </span>
                  )}
                </div>
                
                {/* Animated progress bar with glow */}
                <div className="relative">
                  <div
                    className="h-2.5 overflow-hidden rounded-full"
                    style={{ 
                      background: `${colors.border}50`,
                      boxShadow: `inset 0 1px 2px ${colors.border}`
                    }}
                    role="progressbar"
                    aria-valuenow={levelPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.name} level ${levelPct} out of 100`}
                  >
                    <motion.div
                      data-testid={`signals-layer-level-bar-${row.key}`}
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${levelPct}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        background: getScoreGradient(levelPct),
                        boxShadow: `0 0 12px ${levelPct >= 60 ? colors.bullish : levelPct >= 40 ? colors.accent : colors.caution}60`
                      }}
                    />
                  </div>
                  
                  {/* Score markers */}
                  <div className="flex justify-between mt-1">
                    {[0, 25, 50, 75, 100].map((mark) => (
                      <div 
                        key={mark}
                        className="w-1 h-1 rounded-full"
                        style={{ 
                          background: levelPct >= mark ? colors.textMuted : colors.border,
                          opacity: levelPct >= mark ? 0.8 : 0.3
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="m-0 mt-2 text-xs font-medium" style={{ color: colors.textMuted }}>
                {row.status === "Unavailable" ? "No live level score" : "Level unavailable"}
              </p>
            )}
            
            {/* Insight with styling */}
            {showInsight && (
              <motion.div 
                className="mt-3 pt-3 border-t"
                style={{ borderColor: `${colors.border}50` }}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3 }}
              >
                <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
                  {insight}
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Layer Detail Drawer Component
function LayerDetailDrawer({
  isOpen,
  onClose,
  layer,
  bias,
  colors,
  symbol
}: {
  isOpen: boolean;
  onClose: () => void;
  layer: SignalsLayerRowInput | null;
  bias: SignalsSetupBias;
  colors: ReturnType<typeof useTheme>["colors"];
  symbol: string;
}) {
  if (!layer) return null;

  const IconComponent = LAYER_ICONS[layer.key] || Activity;
  const polarity = layerPolarity(layer, bias);
  const polarityStr = String(polarity);
  const dot = layerPolarityDotColor(polarity);
  const levelLabel = formatLayerScoreLabel(layer.score, layer.status);
  const levelPct = layer.score != null ? Math.max(0, Math.min(100, Number(levelLabel))) : 0;

  // Use actual layer data for specific justifications
  const confidence = levelPct >= 70 ? "High" : levelPct >= 50 ? "Medium" : "Low";
  
  // Build specific justification items based on layer data
  const justificationItems = buildJustificationItems(layer, colors, dot);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: `${colors.background}80` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          
          {/* Drawer */}
          <motion.div
            className="fixed right-0 top-0 h-full z-50 overflow-y-auto"
            style={{ 
              width: "100%",
              maxWidth: "480px",
              background: `linear-gradient(180deg, ${colors.surface}, ${colors.background})`,
              borderLeft: `1px solid ${colors.border}`,
              boxShadow: `-8px 0 32px -8px ${colors.border}60`
            }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div 
              className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between"
              style={{ 
                background: `${colors.surface}f0`,
                backdropFilter: "blur(12px)",
                borderBottom: `1px solid ${colors.border}`
              }}
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${dot}25, ${dot}05)`,
                    border: `1px solid ${dot}40`,
                    boxShadow: `0 4px 12px -4px ${dot}50`
                  }}
                >
                  <div style={{ color: dot }}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <h2 className="m-0 text-lg font-bold" style={{ color: colors.text }}>
                    {layer.name}
                  </h2>
                  <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
                    {layer.companyName || symbol.toUpperCase()} • {bias.toUpperCase()} Setup
                  </p>
                </div>
              </div>
              
              <motion.button
                onClick={onClose}
                className="p-2 rounded-lg transition-colors"
                style={{ 
                  background: colors.surfaceMuted,
                  border: `1px solid ${colors.border}`
                }}
                whileHover={{ background: colors.border, scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <X className="w-5 h-5" style={{ color: colors.textMuted }} />
              </motion.button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Score Card */}
              <div 
                className="rounded-2xl p-5"
                style={{
                  background: `linear-gradient(135deg, ${dot}15, ${dot}05)`,
                  border: `1px solid ${dot}30`
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium" style={{ color: colors.textMuted }}>
                    Layer Score
                  </span>
                  <span 
                    className="px-2 py-1 rounded-full text-xs font-bold uppercase"
                    style={{ 
                      background: `${dot}25`,
                      color: dot
                    }}
                  >
                    {confidence} Confidence
                  </span>
                </div>
                
                <div className="flex items-baseline gap-2">
                  <span 
                    className="text-5xl font-bold tabular-nums"
                    style={{ 
                      color: dot,
                      textShadow: `0 0 30px ${dot}40`
                    }}
                  >
                    {levelLabel}
                  </span>
                  <span className="text-lg font-medium" style={{ color: colors.textMuted }}>
                    /100
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div 
                    className="h-3 rounded-full overflow-hidden"
                    style={{ background: `${colors.border}60` }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${levelPct}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        background: `linear-gradient(90deg, ${dot}, ${dot}80)`,
                        boxShadow: `0 0 16px ${dot}60`
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-xs" style={{ color: colors.textMuted }}>Weak</span>
                    <span className="text-xs" style={{ color: colors.textMuted }}>Strong</span>
                  </div>
                </div>
              </div>

              {/* Our Analysis - Specific Reasoning */}
              {layer.reasoning && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="w-4 h-4" style={{ color: colors.accent }} />
                    <h3 className="m-0 text-sm font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                      Our Analysis
                    </h3>
                  </div>
                  <div 
                    className="p-4 rounded-xl"
                    style={{
                      background: `${colors.surfaceMuted}60`,
                      border: `1px solid ${colors.border}`
                    }}
                  >
                    <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
                      {layer.reasoning}
                    </p>
                  </div>
                </div>
              )}

              {/* Supporting Data Points (Chips) */}
              {layer.chips && layer.chips.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4" style={{ color: colors.accent }} />
                    <h3 className="m-0 text-sm font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                      Supporting Evidence
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {layer.chips.map((chip, i) => (
                      <motion.span
                        key={i}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{
                          background: `${colors.accent}15`,
                          border: `1px solid ${colors.accent}30`,
                          color: colors.text
                        }}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        {chip}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}

              {/* Layer-Specific Justifications */}
              {justificationItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Scale className="w-4 h-4" style={{ color: colors.accent }} />
                    <h3 className="m-0 text-sm font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                      What Drives This Score
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {justificationItems.map((item, i) => (
                      <motion.div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded-xl"
                        style={{
                          background: `${colors.surfaceMuted}80`,
                          border: `1px solid ${colors.border}`
                        }}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                      >
                        <div className="mt-0.5 shrink-0">
                          {item.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="m-0 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
                            {item.label}
                          </p>
                          <p className="m-0 mt-0.5 text-sm" style={{ color: colors.text }}>
                            {item.value}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Context / Why This Matters */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4" style={{ color: colors.accent }} />
                  <h3 className="m-0 text-sm font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                    Why This Matters
                  </h3>
                </div>
                <div 
                  className="p-4 rounded-xl"
                  style={{
                    background: `${polarityStr === "with" ? colors.bullish : polarityStr === "against" ? colors.bearish : colors.accent}10`,
                    border: `1px solid ${polarityStr === "with" ? colors.bullish : polarityStr === "against" ? colors.bearish : colors.accent}25`
                  }}
                >
                  <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
                    This layer is <strong style={{ color: dot }}>{polarityStr === "with" ? "supporting" : polarityStr === "against" ? "countering" : "neutral to"}</strong> your {bias} setup. 
                    {layer.statusLabel && `The ${layer.name.toLowerCase()} reading shows ${layer.statusLabel.toLowerCase()}.`}
                    {layer.explanation && ` ${layer.explanation}`}
                  </p>
                </div>
              </div>

              {/* Last Updated */}
              <div 
                className="flex items-center gap-2 pt-4 border-t"
                style={{ borderColor: colors.border }}
              >
                <FileText className="w-4 h-4" style={{ color: colors.textMuted }} />
                <span className="text-xs" style={{ color: colors.textMuted }}>
                  Analysis updated Just now
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Build specific justification items based on actual layer data
type JustificationItem = {
  icon: React.ReactNode;
  label: string;
  value: string;
};

function buildJustificationItems(
  layer: SignalsLayerRowInput,
  colors: ReturnType<typeof useTheme>["colors"],
  dot: string
): JustificationItem[] {
  const items: JustificationItem[] = [];

  // Technical layer specific items
  if (layer.key === "technical") {
    if (layer.vwapState) {
      items.push({
        icon: <div style={{ color: dot }}><MomentumIcon className="w-4 h-4" /></div>,
        label: "VWAP Position",
        value: layer.vwapState
      });
    }
    if (layer.vwapStateTooltip) {
      items.push({
        icon: <div style={{ color: colors.accent }}><Info className="w-4 h-4" /></div>,
        label: "Technical Context",
        value: layer.vwapStateTooltip
      });
    }
  }

  // News layer specific items
  if (layer.key === "news") {
    if (layer.articleCount !== undefined && layer.articleCount > 0) {
      items.push({
        icon: <div style={{ color: dot }}><NewsIcon className="w-4 h-4" /></div>,
        label: "Articles Analyzed",
        value: `${layer.articleCount} news items in scan window`
      });
    }
    if (layer.headlineSentiment !== null && layer.headlineSentiment !== undefined) {
      const sentiment = layer.headlineSentiment > 0.3 ? "Bullish" : layer.headlineSentiment < -0.3 ? "Bearish" : "Neutral";
      items.push({
        icon: <div style={{ color: dot }}><TrendingUp className="w-4 h-4" /></div>,
        label: "Headline Sentiment",
        value: `${sentiment} (${(layer.headlineSentiment * 100).toFixed(0)}%)`
      });
    }
    if (layer.latestRating) {
      items.push({
        icon: <div style={{ color: colors.accent }}><Target className="w-4 h-4" /></div>,
        label: "Latest Analyst Rating",
        value: layer.latestRating
      });
    }
    if (layer.analystConsensus) {
      items.push({
        icon: <div style={{ color: colors.accent }}><Users className="w-4 h-4" /></div>,
        label: "Analyst Consensus",
        value: layer.analystConsensus
      });
    }
    if (layer.earningsResult) {
      items.push({
        icon: <div style={{ color: dot }}><Calendar className="w-4 h-4" /></div>,
        label: "Recent Earnings",
        value: layer.earningsResult
      });
    }
    if (layer.wimSummary) {
      items.push({
        icon: <div style={{ color: colors.accent }}><FileText className="w-4 h-4" /></div>,
        label: "What It Means",
        value: layer.wimSummary
      });
    }
  }

  // Macro layer specific items
  if (layer.key === "macro") {
    if (layer.macroWarnings && layer.macroWarnings.length > 0) {
      items.push({
        icon: <div style={{ color: colors.caution }}><AlertTriangle className="w-4 h-4" /></div>,
        label: "Macro Warnings",
        value: layer.macroWarnings.join("; ")
      });
    }
    if (layer.upcomingEvents && layer.upcomingEvents.length > 0) {
      const nextEvent = layer.upcomingEvents[0];
      items.push({
        icon: <div style={{ color: dot }}><Calendar className="w-4 h-4" /></div>,
        label: "Upcoming Event",
        value: `${nextEvent.event} (${nextEvent.date})`
      });
    }
    if (layer.yieldCurve) {
      items.push({
        icon: <div style={{ color: dot }}><TrendingUp className="w-4 h-4" /></div>,
        label: "Yield Curve",
        value: `${layer.yieldCurve.status} - ${layer.yieldCurve.signal}`
      });
    }
  }

  // Geopolitical layer specific items
  if (layer.key === "geopolitical") {
    if (layer.geoActiveEvents && layer.geoActiveEvents.length > 0) {
      const topEvent = layer.geoActiveEvents[0];
      items.push({
        icon: <div style={{ color: colors.caution }}><AlertTriangle className="w-4 h-4" /></div>,
        label: "Active Event",
        value: `${topEvent.title} (${topEvent.severity})`
      });
    }
    if (layer.geoExposureSummary) {
      items.push({
        icon: <div style={{ color: colors.accent }}><Info className="w-4 h-4" /></div>,
        label: "Exposure Assessment",
        value: layer.geoExposureSummary
      });
    }
    if (layer.geoExposureBand) {
      items.push({
        icon: <div style={{ color: dot }}><Scale className="w-4 h-4" /></div>,
        label: "Risk Band",
        value: layer.geoExposureBand
      });
    }
    if (layer.geoPrimaryTheme) {
      items.push({
        icon: <div style={{ color: colors.accent }}><FileText className="w-4 h-4" /></div>,
        label: "Primary Theme",
        value: layer.geoPrimaryTheme
      });
    }
  }

  // Sector layer specific items
  if (layer.key === "sector") {
    if (layer.sectorDisplayName) {
      items.push({
        icon: <div style={{ color: dot }}><Building2 className="w-4 h-4" /></div>,
        label: "Sector",
        value: layer.sectorDisplayName
      });
    }
    if (layer.sectorEtf) {
      items.push({
        icon: <div style={{ color: colors.accent }}><Target className="w-4 h-4" /></div>,
        label: "Sector ETF",
        value: layer.sectorEtf
      });
    }
    if (layer.vsSectorPerformance !== null && layer.vsSectorPerformance !== undefined) {
      const perf = layer.vsSectorPerformance;
      const perfStr = perf > 0 ? `+${perf.toFixed(2)}%` : `${perf.toFixed(2)}%`;
      items.push({
        icon: <div style={{ color: perf > 0 ? colors.bullish : colors.bearish }}><MomentumIcon className="w-4 h-4" /></div>,
        label: "vs Sector ETF",
        value: perfStr
      });
    }
    if (layer.sectorMomentum !== null && layer.sectorMomentum !== undefined) {
      items.push({
        icon: <div style={{ color: dot }}><TrendingUp className="w-4 h-4" /></div>,
        label: "Sector Momentum",
        value: `${layer.sectorMomentum.toFixed(1)}/100`
      });
    }
  }

  return items;
}

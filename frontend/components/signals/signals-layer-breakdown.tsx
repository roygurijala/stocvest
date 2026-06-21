"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  FileText,
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
import {
  formatCatalystSourceLabel,
  truncateCatalystHeadline,
  type LayerCatalystArticle
} from "@/lib/signals/layer-catalyst-articles";
import {
  articlesForDrawer,
  buildLayerAlignmentLine,
  filterDisplayChips,
  indicatorHighlights,
  layerAlignmentTextColor,
  layerDataConfidenceTier,
  ratingsForDrawer,
  shouldShowAnalystTimeline,
  shouldShowGeoEventList,
  shouldShowMacroEventList
} from "@/lib/signals/layer-drawer-present";
import { catalystPublishedAgo } from "@/lib/signal-evidence";
import { layerStatusColor, polarityTrendIconKind } from "@/lib/signal-direction-colors";
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

function sensitivityBandTone(band: string): string {
  const b = band.toLowerCase();
  if (b === "low") return "#f87171";
  if (b === "medium") return "#fbbf24";
  return "#34d399";
}

function formatSensitivityMultiplier(mult: number | null | undefined): string {
  if (typeof mult !== "number" || !Number.isFinite(mult)) return "";
  return `${Math.round(mult * 100) / 100}× weight`;
}

function sensitivityBlurb(layerKey: string, band: string): string {
  const isGeo = layerKey === "geopolitical";
  const layerName = isGeo ? "Geopolitical" : "News";
  const b = band.toLowerCase();
  if (b === "low") {
    return isGeo
      ? `This stock carries low geopolitical exposure, so the ${layerName} layer is down-weighted for it.`
      : `This sector rarely reprices on a single headline, so the ${layerName} layer is down-weighted for this stock.`;
  }
  if (b === "medium") {
    return isGeo
      ? `This stock has moderate geopolitical exposure, so the ${layerName} layer is slightly down-weighted for it.`
      : `This sector reacts moderately to headlines, so the ${layerName} layer is slightly down-weighted for this stock.`;
  }
  return isGeo
    ? `This stock carries high geopolitical exposure, so the ${layerName} layer keeps its full weight for it.`
    : `This sector is structurally headline-driven, so the ${layerName} layer keeps its full weight for this stock.`;
}

function SensitivityChip({
  layerKey,
  band,
  multiplier,
  layerName
}: {
  layerKey: string;
  band: string;
  multiplier: number | null | undefined;
  layerName: string;
}) {
  const tone = sensitivityBandTone(band);
  const multLabel = formatSensitivityMultiplier(multiplier);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style={{ background: `${tone}15`, color: tone, border: `1px solid ${tone}30` }}
        data-testid={`signals-layer-sensitivity-${layerKey}`}
      >
        {multLabel ? `${band.toUpperCase()} · ${multLabel}` : band.toUpperCase()}
      </span>
      <InfoTip text={sensitivityBlurb(layerKey, band)} label={`${layerName} sensitivity`} />
    </span>
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
  
  const trendKind = polarityTrendIconKind(String(polarity));
  const TrendIcon =
    trendKind === "up" ? TrendingUp : trendKind === "down" ? TrendingDown : Activity;

  const getStatusGradient = (status: string | undefined) => {
    const tone = layerStatusColor(status, colors);
    return `linear-gradient(90deg, ${tone}, ${tone}80)`;
  };
  const getStatusColor = (status: string | undefined): string => layerStatusColor(status, colors);

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

              {(row.key === "news" || row.key === "geopolitical") && row.sensitivityBand ? (
                <SensitivityChip
                  layerKey={row.key}
                  band={row.sensitivityBand}
                  multiplier={row.sensitivityMultiplier}
                  layerName={row.name}
                />
              ) : null}

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
                        color: getStatusColor(row.status),
                        textShadow: `0 0 20px ${getStatusColor(row.status)}30`
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
                        background: getStatusGradient(row.status),
                        boxShadow: `0 0 12px ${row.status?.toLowerCase() === "bullish" ? colors.bullish : row.status?.toLowerCase() === "bearish" ? colors.bearish : colors.accent}60`
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
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  useEffect(() => {
    setEvidenceExpanded(false);
  }, [layer?.key, symbol]);
  if (!layer) return null;

  const IconComponent = LAYER_ICONS[layer.key] || Activity;
  const polarity = layerPolarity(layer, bias);
  const dot = layerPolarityDotColor(polarity);
  const statusTone = layerStatusColor(layer.status, colors);
  const levelLabel = formatLayerScoreLabel(layer.score, layer.status);
  const levelPct = layer.score != null ? Math.max(0, Math.min(100, Number(levelLabel))) : 0;

  // Use actual layer data for specific justifications
  const confidence = layerDataConfidenceTier(layer);
  
  const displayChips = filterDisplayChips(layer);
  const alignmentLine = buildLayerAlignmentLine(layer, bias, polarity, levelLabel);
  const articlePack = articlesForDrawer(layer.catalystArticles, evidenceExpanded);
  const ratingPack = ratingsForDrawer(layer.recentRatings, evidenceExpanded);
  const indicatorRows = indicatorHighlights(layer.indicatorSnapshot);
  const evidenceOverflow =
    (layer.catalystArticles?.length ?? 0) > articlePack.visible.length ||
    (layer.recentRatings?.length ?? 0) > ratingPack.visible.length;

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
                    {symbol.toUpperCase()} • {bias.toUpperCase()} Setup
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
            <div className="p-6 space-y-5">
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
                      color: statusTone,
                      textShadow: `0 0 30px ${statusTone}40`
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
                        background: `linear-gradient(90deg, ${statusTone}, ${statusTone}80)`,
                        boxShadow: `0 0 16px ${statusTone}60`
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-xs" style={{ color: colors.textMuted }}>Weak</span>
                    <span className="text-xs" style={{ color: colors.textMuted }}>Strong</span>
                  </div>
                </div>
              </div>

              <p
                className="m-0 text-sm leading-snug"
                style={{
                  color: layerAlignmentTextColor(polarity, bias, colors)
                }}
              >
                {alignmentLine}
              </p>

              {(layer.reasoning ?? layer.explanation) ? (
                <div
                  className="rounded-xl p-4"
                  style={{ background: `${colors.surfaceMuted}50`, border: `1px solid ${colors.border}` }}
                >
                  <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
                    {layer.reasoning ?? layer.explanation}
                  </p>
                </div>
              ) : null}

              {(layer.key === "news" || layer.key === "geopolitical") && layer.sensitivityBand ? (
                <LayerFactLine
                  label={layer.key === "geopolitical" ? "Geo sensitivity" : "Headline sensitivity"}
                  value={`${layer.sensitivityBand.toUpperCase()}${
                    formatSensitivityMultiplier(layer.sensitivityMultiplier)
                      ? ` · ${formatSensitivityMultiplier(layer.sensitivityMultiplier)}`
                      : ""
                  }`}
                  colors={colors}
                />
              ) : null}

              {layer.key === "news" && articlePack.visible.length > 0 ? (
                <LayerCatalystArticleList articles={articlePack.visible} colors={colors} />
              ) : null}

              {layer.key === "news" && shouldShowAnalystTimeline(layer) && ratingPack.visible.length > 0 ? (
                <LayerAnalystRatingList ratings={ratingPack.visible} colors={colors} compact />
              ) : null}

              {layer.key === "technical" && indicatorRows.length > 0 ? (
                <LayerIndicatorSnapshot rows={indicatorRows} colors={colors} />
              ) : null}

              {layer.key === "macro" && shouldShowMacroEventList(layer) ? (
                <LayerEventList
                  title="On the calendar"
                  items={(layer.upcomingEvents ?? []).slice(0, evidenceExpanded ? 4 : 2).map((e) => ({
                    primary: e.event,
                    secondary: [e.date, e.impact].filter(Boolean).join(" · ")
                  }))}
                  colors={colors}
                  compact
                />
              ) : null}

              {layer.key === "geopolitical" && shouldShowGeoEventList(layer) ? (
                <LayerEventList
                  title="Active themes"
                  items={(layer.geoActiveEvents ?? []).slice(0, evidenceExpanded ? 4 : 2).map((e) => ({
                    primary: e.title,
                    secondary: e.severity
                  }))}
                  colors={colors}
                  compact
                />
              ) : null}

              {layer.key === "sector" && layer.sectorDailySessions && layer.sectorDailySessions.length > 0 ? (
                <LayerSectorSessions
                  sessions={layer.sectorDailySessions.slice(0, evidenceExpanded ? 4 : 2)}
                  colors={colors}
                />
              ) : null}

              {layer.key === "news" && layer.latestGuidance ? (
                <LayerFactLine label="Guidance" value={layer.latestGuidance} colors={colors} />
              ) : null}

              {layer.key === "news" && layer.earningsResult ? (
                <LayerFactLine label="Earnings" value={layer.earningsResult} colors={colors} />
              ) : null}

              {layer.key === "sector" && layer.sectorInterpretation ? (
                <LayerFactLine label="Sector read" value={layer.sectorInterpretation} colors={colors} />
              ) : null}

              {displayChips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {displayChips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{
                        background: `${colors.surfaceMuted}`,
                        border: `1px solid ${colors.border}`,
                        color: colors.textMuted
                      }}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}

              {evidenceOverflow ? (
                <button
                  type="button"
                  className="text-xs font-semibold"
                  style={{ color: colors.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => setEvidenceExpanded((v) => !v)}
                >
                  {evidenceExpanded ? "Show less detail" : "Show more detail"}
                </button>
              ) : null}

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

function catalystSentimentChip(
  sentiment: LayerCatalystArticle["sentiment"],
  colors: ReturnType<typeof useTheme>["colors"]
): { label: string; fg: string; bg: string; border: string } {
  if (sentiment === "positive") {
    return {
      label: "Bullish",
      fg: colors.bullish,
      bg: `${colors.bullish}1f`,
      border: `1px solid ${colors.bullish}66`
    };
  }
  if (sentiment === "negative") {
    return {
      label: "Bearish",
      fg: colors.bearish,
      bg: `${colors.bearish}1f`,
      border: `1px solid ${colors.bearish}66`
    };
  }
  return {
    label: "Neutral",
    fg: colors.caution,
    bg: `${colors.caution}1a`,
    border: `1px solid ${colors.caution}55`
  };
}

function LayerFactLine({
  label,
  value,
  colors
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div className="flex gap-2 text-sm leading-snug">
      <span className="shrink-0 font-semibold" style={{ color: colors.textMuted }}>
        {label}
      </span>
      <span style={{ color: colors.text }}>{value}</span>
    </div>
  );
}

function LayerCatalystArticleList({
  articles,
  colors
}: {
  articles: LayerCatalystArticle[];
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
        Headlines
      </p>
      <ul className="m-0 p-0 list-none space-y-2">
        {articles.map((article, i) => {
          const chip = catalystSentimentChip(article.sentiment, colors);
          const title = truncateCatalystHeadline(article.text, 100);
          return (
            <li
              key={`${article.text}-${i}`}
              className="rounded-lg px-3 py-2.5"
              style={{ background: `${colors.surfaceMuted}60`, border: `1px solid ${colors.border}` }}
            >
              {article.url ? (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold leading-snug"
                  style={{ color: colors.accent }}
                >
                  {title}
                </a>
              ) : (
                <p className="m-0 text-sm font-semibold leading-snug" style={{ color: colors.text }}>
                  {title}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ border: `1px solid ${colors.border}`, color: colors.textMuted, background: `${colors.surfaceMuted}` }}
                >
                  {formatCatalystSourceLabel(article.source)}
                </span>
                {article.publishedAt ? (
                  <span className="text-[11px]" style={{ color: colors.textMuted }}>
                    {catalystPublishedAgo(article.publishedAt)}
                  </span>
                ) : null}
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ border: chip.border, background: chip.bg, color: chip.fg }}
                >
                  {chip.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LayerEventList({
  title,
  items,
  colors,
  compact = false
}: {
  title: string;
  items: Array<{ primary: string; secondary?: string }>;
  colors: ReturnType<typeof useTheme>["colors"];
  compact?: boolean;
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
        {title}
      </p>
      <ul className="m-0 p-0 list-none space-y-1.5">
        {items.map((item, i) => (
          <li
            key={`${item.primary}-${i}`}
            className={compact ? "text-sm leading-snug" : "rounded-lg px-3 py-2.5"}
            style={
              compact
                ? { color: colors.text }
                : { background: `${colors.surfaceMuted}60`, border: `1px solid ${colors.border}` }
            }
          >
            <span style={{ color: colors.text }}>{item.primary}</span>
            {item.secondary ? (
              <span className={compact ? "text-xs" : "mt-1 block text-xs"} style={{ color: colors.textMuted }}>
                {compact ? ` · ${item.secondary}` : item.secondary}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatIndicatorLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatIndicatorValue(key: string, value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.includes("rsi") || key.includes("pct") || key.includes("range")) {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    if (key.includes("sma") || key.includes("ema") || key.includes("vwap")) {
      return `$${value.toFixed(2)}`;
    }
    if (key === "volume_vs_adv") return `${value.toFixed(2)}x`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value).replace(/_/g, " ");
}

function LayerIndicatorSnapshot({
  rows,
  colors
}: {
  rows: Array<[string, string | number | boolean | null]>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
        Key levels
      </p>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg px-3 py-2"
            style={{ background: `${colors.surfaceMuted}60`, border: `1px solid ${colors.border}` }}
          >
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
              {formatIndicatorLabel(key)}
            </p>
            <p className="m-0 mt-1 text-sm font-semibold tabular-nums" style={{ color: colors.text }}>
              {formatIndicatorValue(key, value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerAnalystRatingList({
  ratings,
  colors,
  compact = false
}: {
  ratings: NonNullable<SignalsLayerRowInput["recentRatings"]>;
  colors: ReturnType<typeof useTheme>["colors"];
  compact?: boolean;
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
        Analyst actions
      </p>
      <ul className="m-0 p-0 list-none space-y-1.5">
        {ratings.map((rating, i) => {
          const actionTone =
            /upgrade|raise|outperform|buy/i.test(`${rating.action} ${rating.rating}`)
              ? colors.bullish
              : /downgrade|cut|underperform|sell/i.test(`${rating.action} ${rating.rating}`)
                ? colors.bearish
                : colors.textMuted;
          return (
            <li
              key={`${rating.firm}-${rating.date}-${i}`}
              className={compact ? "text-sm leading-snug" : "rounded-lg px-3 py-2.5"}
              style={
                compact
                  ? undefined
                  : { background: `${colors.surfaceMuted}60`, border: `1px solid ${colors.border}` }
              }
            >
              <span className="font-semibold" style={{ color: colors.text }}>
                {rating.firm || "Analyst"}
              </span>
              <span className="text-xs" style={{ color: actionTone }}>
                {" "}
                · {[rating.action, rating.rating].filter(Boolean).join(" · ")}
              </span>
              <span className="text-xs" style={{ color: colors.textMuted }}>
                {" "}
                · {rating.date}
                {rating.priceTarget != null ? ` · PT $${rating.priceTarget.toFixed(2)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LayerSectorSessions({
  sessions,
  colors
}: {
  sessions: NonNullable<SignalsLayerRowInput["sectorDailySessions"]>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: colors.textMuted }}>
        vs SPY (recent)
      </p>
      <ul className="m-0 list-none space-y-1 p-0 text-sm leading-snug">
        {sessions.map((session) => {
          const relTone = session.relative >= 0 ? colors.bullish : colors.bearish;
          const rel = `${session.relative >= 0 ? "+" : ""}${session.relative.toFixed(2)}%`;
          return (
            <li key={session.date} style={{ color: colors.text }}>
              <span style={{ color: colors.textMuted }}>{session.date}</span>
              <span style={{ color: relTone }}> {rel}</span>
              <span style={{ color: colors.textMuted }}>
                {" "}
                (ETF {session.etfPct >= 0 ? "+" : ""}
                {session.etfPct.toFixed(2)}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

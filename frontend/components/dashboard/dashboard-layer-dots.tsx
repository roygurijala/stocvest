"use client";

type Props = {
  filled: boolean[];
  total: number;
  accent: string;
  /** Muted track for empty segments. */
  emptyColor?: string;
  size?: "sm" | "md";
  /** Show (n/total) count label beside segments. */
  showCount?: boolean;
};

export function layerDotsFilled(aligned: number, total: number): boolean[] {
  const safeTotal = Math.max(0, Math.round(total));
  const safeAligned = Math.max(0, Math.min(safeTotal, Math.round(aligned)));
  return Array.from({ length: safeTotal }, (_, i) => i < safeAligned);
}

export function DashboardLayerDots({
  filled,
  total,
  accent,
  emptyColor,
  size = "md",
  showCount = true
}: Props) {
  const w = size === "sm" ? 6 : 8;
  const h = size === "sm" ? 4 : 5;
  const gap = size === "sm" ? 3 : 4;
  const empty = emptyColor ?? `color-mix(in srgb, ${accent} 16%, transparent)`;
  const count = filled.filter(Boolean).length;

  return (
    <span className="inline-flex items-center" style={{ gap }} aria-hidden>
      {filled.map((on, i) => (
        <span
          key={i}
          data-testid={on ? "layer-dot-filled" : "layer-dot-empty"}
          style={{
            width: w,
            height: h,
            borderRadius: 999,
            background: on ? accent : empty,
            boxShadow: on ? `0 0 6px color-mix(in srgb, ${accent} 38%, transparent)` : undefined,
            flexShrink: 0
          }}
        />
      ))}
      {showCount ? (
        <span className="ml-1 text-[10px] font-medium tabular-nums opacity-80">
          ({count}/{total})
        </span>
      ) : null}
    </span>
  );
}

export function DashboardLayerDotsFromCount({
  aligned,
  total,
  accent,
  emptyColor,
  size = "md",
  showCount = true
}: {
  aligned: number;
  total: number;
  accent: string;
  emptyColor?: string;
  size?: "sm" | "md";
  showCount?: boolean;
}) {
  const filled = layerDotsFilled(aligned, total);
  return (
    <DashboardLayerDots
      filled={filled}
      total={total}
      accent={accent}
      emptyColor={emptyColor}
      size={size}
      showCount={showCount}
    />
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { scannerToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useHasAIExplanations } from "@/lib/api/user";
import {
  DRIVER_CONFIG,
  LAGGARD_CONFIG,
  driverBadgeColor,
  type DriverType,
  type LaggardType,
  type ScannerLaggardRow,
  type ScannerLaggardsResponse
} from "@/lib/laggard";
import { UpgradePrompt } from "@/components/upgrade-prompt";

type LaggardScannerProps = {
  /** Hide when scanner is in day-only view. */
  visible?: boolean;
};

function badge(color: string, bg: string, children: React.ReactNode) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: borderRadius.full,
        padding: "2px 8px",
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        background: bg,
        color
      }}
    >
      {children}
    </span>
  );
}

export function LaggardScanner({ visible = true }: LaggardScannerProps) {
  const { colors } = useTheme();
  const isPaid = useHasAIExplanations();
  const [data, setData] = useState<ScannerLaggardsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible || !isPaid) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/scanner/laggards?confidence=medium&type=all&driver=all", {
          credentials: "same-origin",
          cache: "no-store"
        });
        if (!res.ok) {
          if (!cancelled) setError(true);
          return;
        }
        const body = (await res.json()) as ScannerLaggardsResponse;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, isPaid]);

  const rows = useMemo(() => {
    const list = data?.laggards ?? [];
    return [...list].sort((a, b) => (b.laggard_score ?? 0) - (a.laggard_score ?? 0));
  }, [data]);

  if (!visible) return null;

  const showEmptyPaid = !loading && !error && rows.length === 0 && isPaid;
  if (showEmptyPaid) return null;

  const shell = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.xl,
    padding: spacing[4]
  } as const;

  if (!isPaid) {
    return (
      <section data-testid="laggard-scanner-upgrade" className={surfaceGlowClassName} style={shell}>
        <h3 style={{ margin: 0 }}>Relative strength divergence</h3>
        <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted, lineHeight: 1.5 }}>
          Stocks lagging sector peers today — context only, not trade signals.
        </p>
        <UpgradePrompt
          feature="Laggard scanner"
          plan="Swing Pro"
          description="Scan your warmed universe for peer divergence."
        />
      </section>
    );
  }

  return (
    <section data-testid="laggard-scanner" className={`min-w-0 ${surfaceGlowClassName}`} style={shell}>
      <div style={{ marginBottom: spacing[2] }}>
        <h3 style={{ margin: 0 }}>Relative strength divergence</h3>
        <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted, lineHeight: 1.45, maxWidth: "42rem" }}>
          Stocks lagging sector peers today — display context only.
        </p>
      </div>
      {loading ? (
        <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
          Scanning peer divergence…
        </p>
      ) : error ? (
        <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
          Laggard scan unavailable right now.
        </p>
      ) : (
        <ul className="m-0 list-none p-0" style={{ display: "grid", gap: spacing[2] }}>
          {rows.map((row) => (
            <LaggardScannerRow key={row.symbol} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LaggardScannerRow({ row }: { row: ScannerLaggardRow }) {
  const { colors } = useTheme();
  const lagType = row.laggard_type as LaggardType | undefined;
  const typeCfg = lagType ? LAGGARD_CONFIG[lagType] : null;
  const driverType = row.driver_type as DriverType | undefined;
  const driverColor = driverBadgeColor(driverType);
  const sym = row.symbol.trim().toUpperCase();
  const isDistribution = lagType === "distribution";

  return (
    <li
      data-testid={`laggard-scanner-row-${sym}`}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${isDistribution ? "rgba(239,68,68,0.35)" : colors.border}`,
        padding: spacing[3],
        background: isDistribution ? "rgba(239,68,68,0.04)" : colors.surfaceMuted
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center", marginBottom: spacing[1] }}>
        <Link
          href={scannerToSignalsHref(sym, "swing")}
          className="font-mono text-sm font-bold no-underline hover:underline"
          style={{ color: colors.text }}
        >
          {sym}
        </Link>
        {row.driver_label ? badge(driverColor, `color-mix(in srgb, ${driverColor} 12%, transparent)`, row.driver_label) : null}
        {typeCfg ? badge(typeCfg.color, typeCfg.bgClass, typeCfg.label) : null}
        {row.confidence ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
            {row.confidence}
            {typeof row.laggard_score === "number" ? ` · ${row.laggard_score.toFixed(0)}` : ""}
          </span>
        ) : null}
      </div>
      {row.summary_line ? (
        <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
          {row.summary_line}
        </p>
      ) : null}
      {isDistribution ? (
        <p className="m-0 mt-1 text-xs" style={{ color: "#dc2626" }}>
          Bearish divergence — relative weakness vs moving peers.
        </p>
      ) : null}
      {row.current_watchlist_state ? (
        <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
          Watchlist: {row.current_watchlist_state}
        </p>
      ) : null}
    </li>
  );
}

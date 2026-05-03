"use client";

import type { CryptoOverview } from "@/lib/api/crypto";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface CryptoPanelProps {
  overview: CryptoOverview;
}

function fmt(value: number | undefined, digits: number = 2): string {
  if (value == null) {
    return "-";
  }
  return value.toFixed(digits);
}

export function CryptoPanel({ overview }: CryptoPanelProps) {
  const { colors } = useTheme();

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Crypto Panel ({overview.symbol})</h2>
      <article
        className={surfaceGlowClassName}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: spacing[4]
        }}
      >
        <p style={{ marginTop: 0, color: colors.bullish, fontWeight: 600 }}>
          Polygon Currencies Starter feed: real-time market data enabled.
        </p>
        <p style={{ marginTop: 0, color: colors.caution, fontWeight: 600 }}>
          On-chain metrics are not included (explicitly deferred in project scope).
        </p>
        {overview.error ? (
          <p style={{ color: colors.bearish, marginBottom: 0 }}>{overview.error}</p>
        ) : (
          <>
            <p style={{ margin: "0 0 8px 0" }}>
              Last price: <strong>{fmt(overview.latestPrice)}</strong>
            </p>
            <p style={{ margin: "0 0 8px 0" }}>
              Last 1m volume: <strong>{fmt(overview.latestVolume, 4)}</strong>
            </p>
            <p style={{ marginBottom: 8, opacity: 0.85 }}>
              Recent bars loaded: {overview.bars.length}
            </p>
          </>
        )}
      </article>
    </section>
  );
}

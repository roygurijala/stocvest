"use client";

import Link from "next/link";
import { spacing } from "@/lib/design-system";
import { ScannerCollapsible } from "@/components/scanner/ScannerCollapsible";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { useTheme } from "@/lib/theme-provider";

export type WatchlistActivityItem = {
  title: string;
  created_at: string;
  symbol?: string | null;
};

type Props = {
  alerts: WatchlistActivityItem[];
  status: "idle" | "loading" | "ready" | "error";
  signalsMode: "swing" | "day" | undefined;
};

export function WatchlistActivityCollapsible({ alerts, status, signalsMode }: Props) {
  const { colors } = useTheme();
  const count = alerts.length;
  const hint =
    status === "loading"
      ? "Loading…"
      : status === "error"
        ? "Unavailable"
        : count > 0
          ? `${count} recent`
          : "None yet";

  return (
    <ScannerCollapsible testId="watchlist-activity" title="Recent activity" hint={hint} embedded>
      {status === "loading" ? (
        <p style={{ margin: 0, fontSize: 12, color: colors.textMuted }}>Loading alert history…</p>
      ) : null}
      {status === "error" ? (
        <p style={{ margin: 0, fontSize: 12, color: colors.bearish }}>Could not load alert history.</p>
      ) : null}
      {status === "ready" && count === 0 ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: colors.textMuted }}>
          Alerts appear when readiness changes after you run evidence from Signals.
        </p>
      ) : null}
      {status === "ready" && count > 0 ? (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: spacing[2],
            fontSize: 12,
            color: colors.text
          }}
        >
          {alerts.map((row, i) => (
            <li key={`${row.created_at}-${i}`}>
              {row.symbol ? (
                <Link
                  href={watchlistToSignalsHref(row.symbol, signalsMode)}
                  prefetch={false}
                  aria-label={watchlistSignalsOpenAriaLabel(row.symbol)}
                  style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}
                  className="hover:underline"
                >
                  {row.symbol}
                </Link>
              ) : (
                <span style={{ fontWeight: 600 }}>Watchlist</span>
              )}
              <span style={{ color: colors.textMuted }}> — {row.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: 11 }}>
        <Link href="/dashboard/settings#alerts" style={{ color: colors.accent, fontWeight: 600 }}>
          Alert preferences
        </Link>
      </p>
    </ScannerCollapsible>
  );
}

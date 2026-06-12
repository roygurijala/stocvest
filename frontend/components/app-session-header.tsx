"use client";

import { type ReactNode } from "react";
import { Menu } from "lucide-react";
import { SymbolSearch } from "@/components/dashboard/trading-room/symbol-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppChrome } from "@/lib/app-chrome-context";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import type { FeedState } from "@/lib/dashboard/trading-room/feed-model";
import {
  asOfTimeET,
  breadthWord,
  sessionWord,
  vixWord
} from "@/lib/session-header-market";
export type SessionHeaderCounts = Record<FeedState, number>;

export type AppSessionHeaderProps = {
  regimeLabel: string;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  marketStatusLabel: string;
  marketOpen: boolean | null;
  counts: SessionHeaderCounts;
  updatedAtIso: string | null;
  onOpenSymbol: (symbol: string, name?: string | null) => void;
  bleed: string;
  isMobile?: boolean;
  colors: ThemeColors;
  /** Optional inline badge (e.g. Preview). */
  badge?: ReactNode;
  searchPlaceholder?: string;
};

export function AppSessionHeader({
  regimeLabel,
  spyPct,
  qqqPct,
  iwmPct,
  vixLevel,
  marketStatusLabel,
  marketOpen,
  counts,
  updatedAtIso,
  onOpenSymbol,
  bleed,
  isMobile: _isMobile = false,
  colors,
  badge,
  searchPlaceholder = "Jump to a symbol or company…"
}: AppSessionHeaderProps) {
  const orbTone =
    marketOpen === true ? colors.bullish : /extended/i.test(marketStatusLabel) ? colors.caution : colors.textMuted;
  const breadth = breadthWord(spyPct, qqqPct, iwmPct);
  const vix = vixWord(vixLevel);
  const session = sessionWord(marketOpen, marketStatusLabel);
  const asOf = asOfTimeET(updatedAtIso);
  const deskIsEmpty = counts.actionable + counts.near + counts.potential + counts.cooling === 0;
  const hasActionable = counts.actionable > 0;
  const chipTone = hasActionable
    ? colors.bullish
    : counts.near > 0 || counts.potential > 0
      ? colors.caution
      : colors.textMuted;
  const vixText = vixLevel != null ? `${vix} (${vixLevel.toFixed(1)})` : vix;

  const regimeTone = /expansion|risk-?on|bull/i.test(regimeLabel)
    ? colors.bullish
    : /contraction|risk-?off|bear/i.test(regimeLabel)
      ? colors.bearish
      : colors.accent;
  const breadthTone =
    breadth === "positive" ? colors.bullish : breadth === "negative" ? colors.bearish : colors.caution;
  const vixTone =
    vix === "calm" ? colors.bullish : vix === "elevated" ? colors.bearish : vix === "moderate" ? colors.caution : colors.textMuted;
  const sessionTone = /active/i.test(session)
    ? colors.bullish
    : /extended|pending/i.test(session)
      ? colors.caution
      : colors.textMuted;

  const Tone = ({ color, children }: { color: string; children: ReactNode }) => (
    <b style={{ color, fontWeight: 600 }}>{children}</b>
  );

  const { openNavDrawer } = useAppChrome();

  const marketLineCompact = (
    <span style={{ lineHeight: 1.4 }}>
      <Tone color={regimeTone}>{regimeLabel}</Tone> · <Tone color={sessionTone}>{session}</Tone> · VIX{" "}
      <Tone color={vixTone}>{vixText}</Tone>
    </span>
  );
  const marketLineFull = (
    <span style={{ lineHeight: 1.4 }}>
      Market in <Tone color={regimeTone}>{regimeLabel}</Tone> · breadth <Tone color={breadthTone}>{breadth}</Tone> · VIX{" "}
      <Tone color={vixTone}>{vixText}</Tone> · <Tone color={sessionTone}>{session}</Tone>
    </span>
  );

  return (
    <div
      data-testid="app-session-header-wrap"
      style={{ ["--session-header-bleed" as string]: bleed }}
    >
      <header
        data-testid="app-session-header"
        className="app-session-header"
        style={{
          display: "flex",
          alignItems: "center",
          columnGap: spacing[3],
          rowGap: spacing[2],
          flexWrap: "wrap",
          paddingTop: `calc(${spacing[3]} + env(safe-area-inset-top, 0px))`,
          paddingRight: bleed,
          paddingBottom: spacing[3],
          paddingLeft: bleed,
          marginLeft: 0,
          marginRight: 0,
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`
        }}
      >
      <button
        type="button"
        className="compact-nav-only"
        aria-label="Open navigation menu"
        onClick={openNavDrawer}
        style={{
          display: "none",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          flex: "none",
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          background: "transparent",
          color: colors.text,
          cursor: "pointer"
        }}
      >
        <Menu size={20} />
      </button>

      <span
        style={{
          fontWeight: 700,
          letterSpacing: "0.16em",
          fontSize: 13,
          flex: "none",
          whiteSpace: "nowrap",
          backgroundImage: `linear-gradient(95deg, ${colors.text} 35%, ${colors.accent})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent"
        }}
      >
        STOCVEST<span style={{ color: colors.accent, WebkitTextFillColor: colors.accent }}>.</span>
      </span>

      {badge ? <div style={{ flex: "none" }}>{badge}</div> : null}

      <div className="compact-nav-only" style={{ marginLeft: badge ? 0 : "auto", flex: "none", display: "none" }}>
        <ThemeToggle />
      </div>

      <div
        className="session-header-market-compact"
        style={{
          display: "none",
          alignItems: "center",
          gap: spacing[3],
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          minWidth: 0,
          flex: "1 1 100%"
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: orbTone,
            boxShadow: marketOpen === true ? `0 0 10px 1px ${orbTone}88` : "none",
            flex: "none"
          }}
        />
        {marketLineCompact}
      </div>

      <div
        className="session-header-market-full"
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[3],
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          minWidth: 0,
          flex: "0 1 auto"
        }}
      >
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: orbTone,
            boxShadow: marketOpen === true ? `0 0 10px 1px ${orbTone}88` : "none",
            flex: "none"
          }}
        />
        {marketLineFull}
      </div>

      <div
        className="session-header-actions"
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[4],
          flexWrap: "wrap",
          minWidth: 0,
          marginLeft: "auto",
          flex: "1 1 100%"
        }}
      >
        <div className="session-header-search" style={{ minWidth: 0 }}>
          <SymbolSearch
            placeholder={searchPlaceholder}
            onPick={onOpenSymbol}
            colors={colors}
            width="100%"
            pill
          />
        </div>

        {!deskIsEmpty ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 6,
              padding: "5px 12px",
              borderRadius: borderRadius.full,
              background: `${chipTone}1a`,
              border: `1px solid ${chipTone}4d`,
              color: chipTone,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              whiteSpace: "nowrap"
            }}
          >
            <span style={{ fontSize: typography.scale.base }}>{counts.actionable}</span> actionable
          </span>
        ) : null}

        <span
          style={{
            fontSize: 11.5,
            color: colors.textMuted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap"
          }}
        >
          Market data as of <b style={{ color: colors.text, fontWeight: 600 }}>{asOf ?? "—"}</b>
        </span>

        <div className="desktop-nav-only" style={{ display: "none" }}>
          <ThemeToggle />
        </div>
      </div>
      </header>
    </div>
  );
}

"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { useStackedLayout } from "@/lib/hooks/use-stacked-layout";

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
  isMobile = false,
  colors,
  badge,
  searchPlaceholder = "Jump to a symbol or company…"
}: AppSessionHeaderProps) {
  const compactNav = useStackedLayout(899);
  const mobile = isMobile || compactNav;
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeightPx, setHeaderHeightPx] = useState(0);

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

  useLayoutEffect(() => {
    if (!mobile) {
      setHeaderHeightPx(0);
      return;
    }
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) setHeaderHeightPx(Math.ceil(h));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [mobile, regimeLabel, counts.actionable, counts.near, counts.potential, counts.cooling]);

  const marketLine = mobile ? (
    <span style={{ lineHeight: 1.4 }}>
      <Tone color={regimeTone}>{regimeLabel}</Tone> · <Tone color={sessionTone}>{session}</Tone> · VIX{" "}
      <Tone color={vixTone}>{vixText}</Tone>
    </span>
  ) : (
    <span style={{ lineHeight: 1.4 }}>
      Market in <Tone color={regimeTone}>{regimeLabel}</Tone> · breadth <Tone color={breadthTone}>{breadth}</Tone> · VIX{" "}
      <Tone color={vixTone}>{vixText}</Tone> · <Tone color={sessionTone}>{session}</Tone>
    </span>
  );

  return (
    <div data-testid="app-session-header-wrap">
      <header
        ref={headerRef}
        data-testid="app-session-header"
        className={mobile ? "app-session-header-mobile" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          columnGap: mobile ? spacing[3] : spacing[5],
          rowGap: spacing[2],
          flexWrap: "wrap",
          padding: mobile
            ? `calc(${spacing[3]} + env(safe-area-inset-top, 0px)) ${bleed} ${spacing[3]}`
            : `${spacing[3]} ${bleed}`,
          marginLeft: mobile ? 0 : `-${bleed}`,
          marginRight: mobile ? 0 : `-${bleed}`,
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
          ...(mobile
            ? {
                position: "fixed" as const,
                top: 0,
                left: 0,
                right: 0,
                zIndex: 30
              }
            : {})
        }}
      >
      {mobile ? (
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={openNavDrawer}
          style={{
            display: "inline-flex",
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
      ) : null}

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

      {mobile ? (
        <div style={{ marginLeft: badge ? 0 : "auto", flex: "none" }}>
          <ThemeToggle />
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[3],
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          minWidth: 0,
          flex: mobile ? "1 1 100%" : "0 1 auto"
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
        {marketLine}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[4],
          flexWrap: "wrap",
          minWidth: 0,
          marginLeft: mobile ? 0 : "auto",
          flex: mobile ? "1 1 100%" : "0 0 auto"
        }}
      >
        <SymbolSearch
          placeholder={searchPlaceholder}
          onPick={onOpenSymbol}
          colors={colors}
          width={mobile ? "100%" : 248}
          pill
        />

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

        {!mobile ? <ThemeToggle /> : null}
      </div>
      </header>
      {mobile && headerHeightPx > 0 ? (
        <div aria-hidden style={{ height: headerHeightPx, flexShrink: 0 }} />
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, type CSSProperties } from "react";

import { typography } from "@/lib/design-system";
import { canTradingRoomHistoryBack, resolveTradingRoomReturnNav } from "@/lib/nav/trading-room-return-nav";

type Props = {
  colors: { textMuted: string };
  onBackToBrief: () => void;
};

const linkStyle = (color: string): CSSProperties => ({
  alignSelf: "flex-start",
  border: "none",
  background: "transparent",
  color,
  fontSize: typography.scale.xs,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  textDecoration: "none"
});

export function DeepDiveReturnLink({ colors, onBackToBrief }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnNav = useMemo(
    () => resolveTradingRoomReturnNav(searchParams.get("ref")),
    [searchParams]
  );

  if (!returnNav) {
    return (
      <button
        type="button"
        onClick={onBackToBrief}
        data-testid="deep-dive-return-link"
        style={linkStyle(colors.textMuted)}
      >
        ← Session brief
      </button>
    );
  }

  return (
    <Link
      href={returnNav.href}
      data-testid="deep-dive-return-link"
      onClick={(e) => {
        if (!canTradingRoomHistoryBack()) return;
        e.preventDefault();
        router.back();
      }}
      style={linkStyle(colors.textMuted)}
    >
      ← {returnNav.label}
    </Link>
  );
}

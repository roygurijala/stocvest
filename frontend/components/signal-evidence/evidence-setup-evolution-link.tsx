"use client";

import Link from "next/link";
import { setupEvolutionHubHref } from "@/lib/nav/setup-analytics-deeplink";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  mode: "swing" | "day";
};

/** Observational link from Evidence to per-symbol setup evolution (not validation ledger). */
export function EvidenceSetupEvolutionLink({ symbol, mode }: Props) {
  const { colors } = useTheme();
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;

  return (
    <p className="m-0 text-xs leading-relaxed" data-testid="evidence-setup-evolution-link">
      <Link
        href={setupEvolutionHubHref(sym, mode)}
        className="font-medium no-underline hover:underline"
        style={{ color: colors.accent }}
      >
        View setup evolution for {sym}
      </Link>
      <span style={{ color: colors.textMuted }}> — past maturation states, not trade performance.</span>
    </p>
  );
}

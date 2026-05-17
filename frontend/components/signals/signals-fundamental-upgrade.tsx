"use client";

import { InfoTip } from "@/components/info-tip";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export function SignalsFundamentalBackdropUpgrade() {
  const { colors } = useTheme();

  return (
    <section
      className="mt-4"
      data-testid="signals-fundamental-backdrop-upgrade"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
          Fundamental backdrop
        </p>
        <InfoTip
          label="Fundamental backdrop"
          text="Slow-moving narrative context (earnings trend, guidance, revenue). Not a seventh layer — does not change alignment or block the setup."
          maxWidth={300}
        />
        <span className="text-[10px] uppercase tracking-wide" style={{ color: colors.textMuted }}>
          (not scored)
        </span>
      </div>
      <div className="mt-2">
        <UpgradePrompt
          feature="Fundamental backdrop"
          plan="Swing Pro"
          description="Upgrade to see earnings trend, guidance direction, and revenue context alongside your swing setup read."
        />
      </div>
    </section>
  );
}

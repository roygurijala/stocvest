"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export interface UpgradePromptProps {
  feature: string;
  plan: string;
  description: string;
  compact?: boolean;
}

export function UpgradePrompt({ feature, plan, description, compact = false }: UpgradePromptProps) {
  const { colors } = useTheme();

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: colors.textMuted }}>
        <span>
          ✦ {feature} — {plan}
        </span>
        <Link
          href="/dashboard/settings"
          className="font-semibold underline-offset-2 hover:underline"
          style={{ color: colors.caution }}
        >
          Upgrade →
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.lg,
        border: "1px solid transparent",
        background: `linear-gradient(${colors.surface}, ${colors.surface}) padding-box, linear-gradient(135deg, rgba(245,158,11,0.55), rgba(59,130,246,0.45)) border-box`,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="text-sm font-bold" style={{ color: colors.text }}>
        ✦ {feature}
      </div>
      <p className="m-0 text-sm leading-relaxed" style={{ color: colors.textMuted }}>
        {description}
      </p>
      <div className="text-xs" style={{ color: colors.textMuted }}>
        Available on {plan}
      </div>
      <Link
        href="/dashboard/settings"
        className="inline-flex w-fit items-center text-sm font-semibold underline-offset-2 hover:underline"
        style={{ color: colors.caution }}
      >
        View Plans →
      </Link>
    </div>
  );
}

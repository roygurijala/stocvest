"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { canSignalsHistoryBack, resolveSignalsReturnNav } from "@/lib/nav/signals-return-nav";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  navigationRef: string | null;
};

export function SignalsReturnLink({ navigationRef }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const returnNav = useMemo(() => resolveSignalsReturnNav(navigationRef ?? ""), [navigationRef]);

  if (!returnNav) return null;

  return (
    <Link
      href={returnNav.href}
      data-testid="signals-return-link"
      onClick={(e) => {
        if (!canSignalsHistoryBack()) return;
        e.preventDefault();
        router.back();
      }}
      className="inline-flex w-fit items-center gap-1 rounded-md no-underline transition-opacity hover:opacity-80"
      style={{
        marginBottom: 2,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        color: colors.textMuted
      }}
    >
      <ArrowLeft size={14} aria-hidden />
      Back to {returnNav.label}
    </Link>
  );
}

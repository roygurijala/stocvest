"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { X } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { DASHBOARD_NAV_ITEMS } from "@/components/sidebar";
import { isDashboardNavItemActive } from "@/lib/dashboard-nav-active";
import { usePathname } from "next/navigation";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  userLabel: string;
}

export function MobileNavDrawer({ open, onClose, userLabel }: MobileNavDrawerProps) {
  const pathname = usePathname();
  const { colors } = useTheme();

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[10000] cursor-default border-0 bg-black/50 lg:hidden"
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed left-0 top-0 z-[10001] flex h-full w-[min(100vw-3rem,288px)] max-w-[100vw] flex-col shadow-xl lg:hidden"
            style={{
              background: colors.surface,
              borderRight: `1px solid ${colors.border}`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex shrink-0 items-center justify-between"
              style={{ padding: spacing[4], borderBottom: `1px solid ${colors.border}` }}
            >
              <Link
                href="/dashboard"
                onClick={onClose}
                style={{
                  color: colors.accent,
                  fontWeight: 700,
                  fontSize: typography.scale.xl,
                  letterSpacing: "0.03em"
                }}
              >
                STOCVEST
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border"
                style={{
                  borderColor: colors.border,
                  background: "transparent",
                  color: colors.text,
                  cursor: "pointer"
                }}
                aria-label="Close menu"
              >
                <X size={22} />
              </button>
            </div>

            <nav
              className="min-h-0 flex-1 overflow-y-auto"
              style={{ padding: spacing[4], display: "grid", gap: spacing[2], alignContent: "start" }}
            >
              {DASHBOARD_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = isDashboardNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: spacing[3],
                      borderRadius: borderRadius.md,
                      padding: `${spacing[3]} ${spacing[3]}`,
                      borderLeft: `3px solid ${isActive ? colors.accent : "transparent"}`,
                      background: isActive ? "rgba(59,130,246,0.12)" : "transparent",
                      color: isActive ? colors.accent : colors.text,
                      fontSize: typography.scale.sm,
                      fontWeight: isActive ? 600 : 500,
                      minHeight: 44
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div
              className="shrink-0"
              style={{
                padding: spacing[4],
                borderTop: `1px solid ${colors.border}`,
                display: "grid",
                gap: spacing[3]
              }}
            >
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, overflowWrap: "anywhere" }}>{userLabel}</p>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium"
                  style={{
                    borderColor: colors.border,
                    background: "transparent",
                    color: colors.text,
                    cursor: "pointer",
                    padding: `${spacing[2]} ${spacing[3]}`
                  }}
                >
                  Sign out
                </button>
              </form>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

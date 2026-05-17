"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  alignedLayerNames,
  formatMaturationBiasLabel,
  maturationAlignmentCounts,
  missingLayerNames
} from "@/lib/watchlist-alignment-present";
import { formatWatchlistMaturationLabel } from "@/lib/watchlist-page-utils";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  open: boolean;
  symbol: string;
  deskMode: "swing" | "day";
  row: WatchlistMaturationRow | undefined;
  onClose: () => void;
};

export function WatchlistAlignmentSheet({ open, symbol, deskMode, row, onClose }: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const { aligned, total } = maturationAlignmentCounts(row);
  const alignedNames = alignedLayerNames(row);
  const missing = missingLayerNames(row);
  const biasLabel = formatMaturationBiasLabel(row?.bias ?? null);
  const stateLabel = formatWatchlistMaturationLabel(row);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[94] grid place-items-end p-0 sm:place-items-center sm:p-3"
          style={{ background: "rgba(2,6,23,0.72)" }}
          onClick={onClose}
          data-testid="watchlist-alignment-overlay"
        >
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className={`w-full max-w-none sm:max-w-md ${surfaceGlowClassName}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: `${borderRadius.xl} ${borderRadius.xl} 0 0`,
              padding: spacing[5],
              maxHeight: "min(85vh, 520px)",
              overflowY: "auto"
            }}
            data-testid="watchlist-alignment-sheet"
            role="dialog"
            aria-labelledby="watchlist-alignment-title"
          >
            <header className="flex items-start justify-between gap-3">
              <motion.div>
                <p
                  className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: colors.textMuted }}
                >
                  {deskMode === "swing" ? "Swing" : "Day"} · Alignment
                </p>
                <h2 id="watchlist-alignment-title" className="m-0 mt-1 text-xl font-bold" style={{ color: colors.text }}>
                  {symU}
                </h2>
                <p className="m-0 mt-1 text-sm" style={{ color: colors.textMuted }}>
                  {stateLabel} · <strong style={{ color: colors.text }}>{aligned}</strong> / {total} aligned
                </p>
              </motion.div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 border-0 bg-transparent p-1"
                style={{ color: colors.textMuted, cursor: "pointer" }}
              >
                <X size={18} aria-hidden />
              </button>
            </header>

            {biasLabel ? (
              <p className="m-0 mt-3 text-sm" style={{ color: colors.textMuted }}>
                Directional bias: <span style={{ color: colors.text, fontWeight: 600 }}>{biasLabel}</span>
                {aligned < 4 ? " — not yet an actionable setup" : null}
              </p>
            ) : null}

            <section className="mt-4" style={{ display: "grid", gap: spacing[3] }}>
              <motion.div>
                <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                  Aligned
                </p>
                {alignedNames.length > 0 ? (
                  <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm" style={{ color: colors.text }}>
                    {alignedNames.map((name) => (
                      <li key={name}>✓ {name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted }}>
                    No layers aligned yet on this desk.
                  </p>
                )}
              </motion.div>
              <motion.div>
                <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                  Missing
                </p>
                <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm" style={{ color: colors.textMuted }}>
                  {missing.map((name) => (
                    <li key={name}>• {name}</li>
                  ))}
                </ul>
              </motion.div>
            </section>

            <p className="m-0 mt-4 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              Scenario Builder on this row uses the same composite evidence as Signals when available. Open{" "}
              <strong style={{ color: colors.text }}>Signals</strong> for the full layer read and evidence modal.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

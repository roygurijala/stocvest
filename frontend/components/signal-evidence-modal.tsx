"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { CuteLoader } from "@/components/cute-loader";
import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import type { SignalEvidenceData } from "@/lib/signal-evidence";

interface SignalEvidenceModalProps {
  evidence: SignalEvidenceData | null;
  open: boolean;
  loading?: boolean;
  loadingSymbol?: string | null;
  onClose: () => void;
  onOpenNewsPanel?: (symbol: string) => void;
  gapIntelSnapshot?: GapIntelSnapshot | null;
}

export function SignalEvidenceModal({
  evidence,
  open,
  loading = false,
  loadingSymbol = null,
  onClose,
  onOpenNewsPanel,
  gapIntelSnapshot = null
}: SignalEvidenceModalProps) {
  const { colors } = useTheme();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] grid place-items-stretch p-0 lg:place-items-center lg:p-3"
          style={{
            background: "rgba(2,6,23,0.75)"
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className={`flex max-h-none min-h-screen w-full max-w-none flex-col overflow-hidden rounded-none lg:max-h-[95vh] lg:min-h-0 lg:w-[min(1000px,100vw-1.5rem)] lg:rounded-xl ${surfaceGlowClassName}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              padding: spacing[4]
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Signal evidence"
            data-testid="signal-evidence-modal"
          >
            <header
              className="z-10 shrink-0 pb-2"
              style={{
                background: colors.surface,
                borderBottom: `1px solid color-mix(in srgb, ${colors.border} 55%, transparent)`
              }}
            >
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border"
                  style={{
                    borderColor: colors.border,
                    background: colors.surface,
                    color: colors.text,
                    cursor: "pointer"
                  }}
                  aria-label="Close evidence"
                  data-testid="signal-evidence-modal-close"
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading || !evidence ? (
                <div
                  className="grid place-items-center"
                  style={{ minHeight: "42vh", color: colors.text, padding: spacing[4] }}
                  aria-live="polite"
                  aria-busy="true"
                >
                  <CuteLoader
                    compact
                    label={`Preparing signal${loadingSymbol ? ` for ${loadingSymbol}` : ""}...`}
                    sublabel="Fetching snapshot, news, and six-layer synthesis."
                  />
                </div>
              ) : (
                <SignalEvidenceCard
                  evidence={evidence}
                  onOpenNewsPanel={onOpenNewsPanel}
                  gapIntelSnapshot={gapIntelSnapshot}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

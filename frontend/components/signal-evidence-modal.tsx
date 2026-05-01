"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { SignalEvidenceData } from "@/lib/signal-evidence";

interface SignalEvidenceModalProps {
  evidence: SignalEvidenceData | null;
  open: boolean;
  onClose: () => void;
}

export function SignalEvidenceModal({ evidence, open, onClose }: SignalEvidenceModalProps) {
  const { colors } = useTheme();
  return (
    <AnimatePresence>
      {open && evidence ? (
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
            className="flex max-h-none min-h-screen w-full max-w-none flex-col overflow-y-auto rounded-none lg:max-h-[95vh] lg:min-h-0 lg:w-[min(1000px,100vw-1.5rem)] lg:rounded-xl"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              padding: spacing[4]
            }}
          >
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md border"
                style={{
                  borderColor: colors.border,
                  background: "transparent",
                  color: colors.text,
                  cursor: "pointer"
                }}
                aria-label="Close evidence"
              >
                <X size={18} />
              </button>
            </div>
            <SignalEvidenceCard evidence={evidence} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

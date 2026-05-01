"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { SignalEvidenceCard } from "@/components/signal-evidence-card";
import { borderRadius, spacing } from "@/lib/design-system";
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
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.75)",
            zIndex: 90,
            display: "grid",
            placeItems: "center",
            padding: spacing[3]
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1000px, 100vw)",
              maxHeight: "95vh",
              overflow: "auto",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: spacing[2] }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  background: "transparent",
                  color: colors.text,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 34,
                  cursor: "pointer"
                }}
                aria-label="Close evidence"
              >
                <X size={16} />
              </button>
            </div>
            <SignalEvidenceCard evidence={evidence} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

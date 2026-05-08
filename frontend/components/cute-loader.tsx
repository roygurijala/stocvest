"use client";

import { motion } from "framer-motion";

interface CuteLoaderProps {
  label?: string;
  sublabel?: string;
  compact?: boolean;
}

export function CuteLoader({
  label = "Loading...",
  sublabel = "Fetching fresh market context",
  compact = false
}: CuteLoaderProps) {
  const ringSize = compact ? 34 : 46;
  const ringStroke = compact ? 2 : 2.5;
  return (
    <div className="grid place-items-center gap-3 text-center">
      <div
        style={{
          width: ringSize,
          height: ringSize,
          position: "relative",
          display: "grid",
          placeItems: "center"
        }}
        aria-hidden
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            border: `${ringStroke}px solid rgba(148,163,184,0.28)`
          }}
        />
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1.05, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            border: `${ringStroke}px solid transparent`,
            borderTopColor: "rgba(56,189,248,0.95)",
            borderRightColor: "rgba(99,102,241,0.82)",
            boxShadow: "0 0 18px rgba(59,130,246,0.25)"
          }}
        />
        <motion.span
          animate={{ scale: [0.92, 1.05, 0.92], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          style={{
            width: compact ? 6 : 8,
            height: compact ? 6 : 8,
            borderRadius: 999,
            background: "rgba(125,211,252,0.95)",
            boxShadow: "0 0 14px rgba(56,189,248,0.55)"
          }}
        />
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        <strong style={{ fontSize: compact ? 14 : 16 }}>{label}</strong>
        <span style={{ fontSize: compact ? 11 : 12, color: "var(--color-text-muted)" }}>{sublabel}</span>
      </div>
    </div>
  );
}


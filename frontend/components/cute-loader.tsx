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
  const size = compact ? 18 : 22;
  return (
    <div className="grid place-items-center gap-3 text-center">
      <motion.div
        initial={{ scale: 0.96, opacity: 0.85 }}
        animate={{ scale: 1.02, opacity: 1 }}
        transition={{ duration: 0.9, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
        style={{
          fontSize: compact ? 26 : 32,
          lineHeight: 1
        }}
        aria-hidden
      >
        📈
      </motion.div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }} aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ y: [0, -5, 0], opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
            style={{
              width: size,
              height: size,
              borderRadius: 999,
              background: "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(34,197,94,0.85))",
              boxShadow: "0 0 0 1px rgba(148,163,184,0.3), 0 3px 14px rgba(30,64,175,0.35)"
            }}
          />
        ))}
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        <strong style={{ fontSize: compact ? 14 : 16 }}>{label}</strong>
        <span style={{ fontSize: compact ? 11 : 12, color: "var(--color-text-muted)" }}>{sublabel}</span>
      </div>
    </div>
  );
}


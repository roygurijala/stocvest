"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme-provider";

const DEFAULT_SLOW_MS = 3000;

export interface ContentLoadingProps {
  /** Nested routes (e.g. settings) — smaller footprint. */
  compact?: boolean;
  /** After this many ms, show a short reassurance line (if still loading). */
  slowHintAfterMs?: number;
  /** Set false to disable the slow-load hint (e.g. tiny embeds). */
  showSlowHint?: boolean;
}

/** Route / segment loading: motion + “Loading…”, optional copy after a few seconds. */
export function ContentLoading({
  compact = false,
  slowHintAfterMs = DEFAULT_SLOW_MS,
  showSlowHint = true
}: ContentLoadingProps) {
  const { colors } = useTheme();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!showSlowHint || slowHintAfterMs <= 0) {
      return;
    }
    const id = window.setTimeout(() => setSlow(true), slowHintAfterMs);
    return () => {
      window.clearTimeout(id);
    };
  }, [showSlowHint, slowHintAfterMs]);

  const outer = compact ? 58 : 72;
  const ringOuter = compact ? 46 : 56;
  const ringInner = compact ? 30 : 36;
  const dot = compact ? 8 : 10;
  const gap = compact ? "1.25rem" : "1.75rem";
  const minH = compact ? "min(220px, 36vh)" : "min(400px, 50vh)";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap,
        minHeight: minH,
        width: "100%"
      }}
    >
      <div
        style={{
          position: "relative",
          width: outer,
          height: outer,
          display: "grid",
          placeItems: "center"
        }}
        aria-hidden
      >
        <motion.div
          style={{
            position: "absolute",
            inset: compact ? 3 : 4,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${colors.accent}40 0%, transparent 68%)`,
            filter: "blur(10px)"
          }}
          animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.88, 1.12, 0.88] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            width: ringOuter,
            height: ringOuter,
            borderRadius: "50%",
            border: `${compact ? 1.5 : 2}px solid ${colors.border}`,
            borderTopColor: colors.accent,
            borderRightColor: `${colors.bullish}bb`,
            boxShadow: `0 0 22px ${colors.accent}28`
          }}
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 3.8, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            width: ringInner,
            height: ringInner,
            borderRadius: "50%",
            border: "1.5px solid transparent",
            borderBottomColor: colors.caution,
            borderLeftColor: `${colors.accent}99`
          }}
        />
        <motion.span
          animate={{ scale: [1, 1.18, 1], opacity: [0.82, 1, 0.82] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: "easeInOut" }}
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: `linear-gradient(145deg, ${colors.accent}, ${colors.bullish})`,
            boxShadow: `0 0 18px ${colors.accent}55`
          }}
        />
      </div>

      <p
        style={{
          margin: 0,
          display: "flex",
          alignItems: "baseline",
          gap: "0.02em",
          fontSize: compact ? "0.875rem" : "0.9375rem",
          fontWeight: 500,
          letterSpacing: "0.04em",
          color: colors.textMuted
        }}
      >
        <motion.span
          style={{
            backgroundImage: `linear-gradient(100deg, ${colors.textMuted} 0%, ${colors.text} 42%, ${colors.textMuted} 85%)`,
            backgroundSize: "220% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent"
          }}
          animate={{ backgroundPosition: ["100% 0", "-120% 0"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        >
          Loading
        </motion.span>
        <span style={{ display: "inline-flex" }} aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              style={{ display: "inline-block", color: colors.accent }}
              animate={{ opacity: [0.15, 1, 0.15], y: [0, -3, 0] }}
              transition={{
                duration: 0.7,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.14
              }}
            >
              .
            </motion.span>
          ))}
        </span>
      </p>

      {slow ? (
        <motion.p
          key="slow"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{
            margin: 0,
            marginTop: compact ? "-0.25rem" : "-0.35rem",
            maxWidth: compact ? 240 : 300,
            padding: "0 0.5rem",
            textAlign: "center",
            fontSize: compact ? "0.75rem" : "0.8125rem",
            lineHeight: 1.45,
            color: colors.textMuted
          }}
        >
          Still loading — first open or a slow connection can take a few extra seconds.
        </motion.p>
      ) : null}
    </div>
  );
}

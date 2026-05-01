"use client";

import { motion } from "framer-motion";
import { useTheme } from "@/lib/theme-provider";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="7" y2="7" />
        <line x1="17" y1="17" x2="19.1" y2="19.1" />
        <line x1="17" y1="7" x2="19.1" y2="4.9" />
        <line x1="4.9" y1="19.1" x2="7" y2="17" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.8 2.3a1 1 0 0 0-1.24 1.24 8 8 0 1 1-9.8 9.8 1 1 0 0 0-1.24 1.24A10 10 0 1 0 14.8 2.3Z"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <motion.button
      type="button"
      onClick={toggleTheme}
      whileTap={{ scale: 0.95 }}
      animate={{ rotate: isDark ? 0 : 180 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="h-11 w-11 min-h-[44px] min-w-[44px] shrink-0"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9999,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        color: "var(--color-text)"
      }}
    >
      <motion.span
        key={theme}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.18 }}
      >
        {isDark ? <MoonIcon /> : <SunIcon />}
      </motion.span>
    </motion.button>
  );
}

"use client";

import { motion } from "framer-motion";

export function PageLoader() {
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-[#0a0e1a]/50 backdrop-blur-[1px]">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-label="Loading page">
        <circle cx="32" cy="32" r="22" stroke="rgba(59,130,246,0.18)" strokeWidth="7" fill="transparent" />
        <motion.circle
          cx="32"
          cy="32"
          r="22"
          stroke="#3b82f6"
          strokeWidth="7"
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray="92 138"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: "50% 50%" }}
        />
      </svg>
    </div>
  );
}

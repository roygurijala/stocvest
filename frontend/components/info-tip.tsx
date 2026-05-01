"use client";

import { Info } from "lucide-react";

/** Accessible hint: full explanation in native tooltip (no proprietary detail). */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <span
      role="img"
      aria-label={label ?? "More information"}
      title={text}
      style={{ display: "inline-flex", cursor: "help", color: "inherit", opacity: 0.72, verticalAlign: "middle" }}
    >
      <Info size={15} strokeWidth={2} aria-hidden />
    </span>
  );
}

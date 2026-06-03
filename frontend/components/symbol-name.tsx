"use client";

import type { CSSProperties, ReactNode } from "react";
import { useSymbolName } from "@/lib/hooks/use-symbol-names";

type Props = {
  symbol: string;
  /** Pre-resolved company name. When omitted, it is fetched (unless `resolve` is false). */
  name?: string | null;
  /** Set false to never trigger a network lookup (only show a name if `name` is passed). */
  resolve?: boolean;
  /** "inline" shows `SYM · Company`; "stacked" puts the company name on a second line. */
  layout?: "inline" | "stacked";
  /** Truncate the company name to this many characters (ellipsis). */
  maxNameChars?: number;
  className?: string;
  style?: CSSProperties;
  symbolStyle?: CSSProperties;
  nameStyle?: CSSProperties;
  /** Optional node rendered between the symbol and the name (e.g. a direction chip). */
  children?: ReactNode;
};

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Renders a ticker with its company name shown clearly alongside it. Falls back
 * to the bare ticker when no name is known. Names resolve via the shared
 * `useSymbolNames` cache unless one is passed in or `resolve` is disabled.
 *
 * Intentionally theme-agnostic: the symbol inherits the surrounding text color
 * and the company name is rendered muted via opacity, so this works inside any
 * container (with or without a ThemeProvider in scope).
 */
export function SymbolName({
  symbol,
  name,
  resolve = true,
  layout = "inline",
  maxNameChars = 42,
  className,
  style,
  symbolStyle,
  nameStyle,
  children
}: Props) {
  const sym = (symbol || "").trim().toUpperCase();
  const auto = useSymbolName(resolve && !name ? sym : undefined);
  const company = (name ?? auto ?? "").trim();

  const symEl = <span style={{ fontWeight: 600, ...symbolStyle }}>{sym}</span>;
  const nameEl = company ? (
    <span
      title={company}
      style={{
        opacity: 0.62,
        fontSize: "0.82em",
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        ...nameStyle
      }}
    >
      {truncate(company, maxNameChars)}
    </span>
  ) : null;

  if (layout === "stacked") {
    return (
      <span className={className} style={{ display: "inline-flex", flexDirection: "column", minWidth: 0, ...style }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {symEl}
          {children}
        </span>
        {nameEl}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0, ...style }}
    >
      {symEl}
      {children}
      {nameEl ? (
        <>
          <span aria-hidden style={{ opacity: 0.62, fontSize: "0.82em" }}>
            ·
          </span>
          {nameEl}
        </>
      ) : null}
    </span>
  );
}

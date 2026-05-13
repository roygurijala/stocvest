"use client";

import { AlertTriangle, KeyRound, RotateCcw, ServerCrash, Wifi } from "lucide-react";

import type { AdminApiReadError } from "@/lib/api/admin-users";
import { borderRadius, cardSurfaceStyle, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Reusable error card for admin list/detail surfaces.
 *
 * Renders the actual HTTP status, a short summary, and an actionable
 * hint pulled from `classifyAdminReadStatus`. The previous UX
 * collapsed every failure (404 / 403 / 401 / 5xx) to one opaque
 * "Failed to load X" line, which forced operators to crack open
 * DevTools to see the real status. That made deploy gaps invisible:
 * a 404 from a route that hadn't been deployed looked identical to
 * a 500 from a runtime crash.
 *
 * The hint copy is owned by `classifyAdminReadStatus` (in
 * `lib/api/admin-users.ts`) so every admin page renders the same
 * action for the same failure mode.
 */
export function AdminApiErrorCard({
  error,
  onRetry,
  testId
}: {
  error: AdminApiReadError;
  onRetry?: () => void;
  testId?: string;
}) {
  const { colors } = useTheme();
  const tone =
    error.code === "unauthenticated" || error.code === "network_error"
      ? "caution"
      : "bearish";
  const surface = cardSurfaceStyle(colors, tone);
  const Icon = pickIcon(error.code);
  return (
    <div
      data-testid={testId ?? "admin-api-error-card"}
      data-error-code={error.code}
      data-error-status={error.status}
      style={{
        ...surface,
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        display: "flex",
        alignItems: "flex-start",
        gap: spacing[3]
      }}
      role="alert"
    >
      <div style={{ marginTop: 2, color: tone === "bearish" ? colors.bearish : colors.caution }}>
        <Icon size={18} aria-hidden />
      </div>
      <div style={{ display: "grid", gap: spacing[2], flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: spacing[2],
            flexWrap: "wrap"
          }}
        >
          <span
            style={{
              color: colors.text,
              fontWeight: 700,
              fontSize: typography.scale.sm
            }}
          >
            {error.message}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              padding: `2px ${spacing[2]}`,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md
            }}
          >
            HTTP {error.status || "—"}
          </span>
        </div>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            lineHeight: 1.55
          }}
        >
          {error.hint}
        </p>
        {onRetry ? (
          <div>
            <button
              type="button"
              onClick={onRetry}
              data-testid={`${testId ?? "admin-api-error-card"}-retry`}
              style={{
                marginTop: spacing[1],
                display: "inline-flex",
                alignItems: "center",
                gap: spacing[2],
                padding: `${spacing[2]} ${spacing[3]}`,
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.accent}`,
                background: "rgba(59,130,246,0.10)",
                color: colors.accent,
                fontSize: typography.scale.sm,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              <RotateCcw size={14} aria-hidden /> Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function pickIcon(code: AdminApiReadError["code"]) {
  switch (code) {
    case "unauthenticated":
    case "forbidden":
      return KeyRound;
    case "network_error":
      return Wifi;
    case "not_deployed":
      return ServerCrash;
    default:
      return AlertTriangle;
  }
}

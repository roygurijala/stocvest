"use client";

import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import type { ThemeColors } from "@/lib/design-system";
import { spacing, typography } from "@/lib/design-system";
import type { AssistantMessage } from "@/lib/assistant/types";

/**
 * No-bubble vertical timeline for STOCVEST Assistant turns.
 *
 * Distinguishing details (the "calm authority" look):
 * - a thin gradient rail down the left edge
 * - speaker nodes are small filled circles on the rail
 * - speaker labels are 10px uppercase tracking-wide, deliberately quiet
 * - assistant messages render with a per-word fade-in for the most recent turn
 * - no chat bubbles, no emoji, no balloon tails — this is meant to read like a calm log
 */
interface AssistantConversationRailProps {
  messages: AssistantMessage[];
  colors: ThemeColors;
  /** Tone driving the assistant node color when contextual: caution / bullish / bearish / neutral. */
  contextTone: "neutral" | "bullish" | "bearish" | "caution";
}

function nodeColor(
  role: AssistantMessage["role"],
  colors: ThemeColors,
  contextTone: AssistantConversationRailProps["contextTone"]
): string {
  if (role === "user") return colors.accent;
  if (contextTone === "bullish") return colors.bullish;
  if (contextTone === "bearish") return colors.bearish;
  if (contextTone === "caution") return colors.caution;
  return colors.textMuted;
}

function speakerLabel(role: AssistantMessage["role"]): string {
  return role === "user" ? "YOU" : "STOCVEST";
}

export const AssistantConversationRail = memo(function AssistantConversationRail({
  messages,
  colors,
  contextTone
}: AssistantConversationRailProps) {
  return (
    <ol
      style={{
        position: "relative",
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: spacing[4]
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 7,
          top: 8,
          bottom: 8,
          width: 2,
          background:
            "linear-gradient(180deg, rgba(56,189,248,0.0) 0%, rgba(56,189,248,0.38) 18%, rgba(56,189,248,0.38) 82%, rgba(56,189,248,0.0) 100%)",
          borderRadius: 2,
          pointerEvents: "none"
        }}
      />
      {messages.map((m) => (
        <ConversationRow key={m.id} message={m} colors={colors} contextTone={contextTone} />
      ))}
    </ol>
  );
});

interface ConversationRowProps {
  message: AssistantMessage;
  colors: ThemeColors;
  contextTone: AssistantConversationRailProps["contextTone"];
}

function ConversationRow({ message, colors, contextTone }: ConversationRowProps) {
  const tone = nodeColor(message.role, colors, contextTone);
  /**
   * Speaker labels are color-coded so user input is visually distinct from STOCVEST output
   * at a glance: "YOU" picks up the accent, "STOCVEST" picks up the page tone (caution /
   * bullish / bearish / neutral muted). The message body also carries a 2px ribbon in the
   * same tone on its left edge, mirroring the rail node — clear role attribution without
   * reverting to chat bubbles.
   */
  const labelStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: tone,
    textTransform: "uppercase"
  };
  const bodyWrapperStyle: CSSProperties = {
    borderLeft: `2px solid ${tone}`,
    paddingLeft: spacing[2],
    background: message.role === "user" ? `${tone}0d` : "transparent",
    borderRadius: 2
  };

  return (
    <li
      style={{
        position: "relative",
        paddingLeft: 32,
        display: "grid",
        gap: spacing[1]
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 4,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: tone,
          boxShadow: `0 0 0 3px ${colors.surface}, 0 0 0 4px ${tone}25`
        }}
      />
      <span style={labelStyle}>{speakerLabel(message.role)}</span>
      <div style={bodyWrapperStyle}>
        <MessageBody message={message} colors={colors} />
      </div>
    </li>
  );
}

function MessageBody({ message, colors }: { message: AssistantMessage; colors: ThemeColors }) {
  if (message.role === "assistant" && message.pending) {
    return (
      <span
        aria-label="STOCVEST Assistant is thinking"
        style={{
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          display: "inline-flex",
          alignItems: "center",
          gap: 2
        }}
      >
        <span className="stocvest-assistant-thinking-dot" />
        <span className="stocvest-assistant-thinking-dot" />
        <span className="stocvest-assistant-thinking-dot" />
      </span>
    );
  }
  if (message.role === "assistant" && message.fresh) {
    return <FreshAssistantText text={message.content} colors={colors} />;
  }
  return (
    <p
      style={{
        margin: 0,
        color: colors.text,
        fontSize: typography.scale.sm,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap"
      }}
    >
      {message.content}
    </p>
  );
}

/**
 * Word-fade reveal — every whitespace-separated token enters with a small per-word stagger.
 * The animation length is capped (we never apply a delay larger than ~3.6s) so even long
 * answers finish revealing quickly enough to feel responsive.
 */
function FreshAssistantText({ text, colors }: { text: string; colors: ThemeColors }) {
  const words = useMemo(() => splitForReveal(text), [text]);
  return (
    <p
      style={{
        margin: 0,
        color: colors.text,
        fontSize: typography.scale.sm,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap"
      }}
    >
      {words.map((w, i) => (
        <span
          key={`${i}-${w.token}`}
          className="stocvest-assistant-word"
          style={{ animationDelay: `${Math.min(i * 38, 3600)}ms` }}
        >
          {w.token}
        </span>
      ))}
    </p>
  );
}

interface RevealToken {
  token: string;
}

/** Split keeping whitespace attached so wrapping behaves naturally. */
function splitForReveal(text: string): RevealToken[] {
  if (!text) return [];
  const parts = text.match(/\S+\s*/g) ?? [text];
  return parts.map((token) => ({ token }));
}

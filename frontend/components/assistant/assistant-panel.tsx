"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import { Send, X } from "lucide-react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type {
  AssistantLayerKey,
  AssistantLayerStatus,
  AssistantMessage,
  AssistantPageContext
} from "@/lib/assistant/types";
import { AssistantConversationRail } from "@/components/assistant/assistant-conversation-rail";

interface AssistantPanelProps {
  colors: ThemeColors;
  context: AssistantPageContext | null;
  messages: AssistantMessage[];
  composerValue: string;
  setComposerValue: (next: string) => void;
  onSubmit: (text: string) => void;
  onClose: () => void;
  loading: boolean;
  /** Optional gentle hint surfaced under the composer (e.g. upgrade or transient error). */
  notice?: string | null;
  /**
   * Whether the active visitor has a STOCVEST session. Controls the empty-state copy,
   * quick prompts (anonymous visitors get marketing-flavored entry points like "What is
   * STOCVEST?" / "How is STOCVEST different from signal-alert services?" / "What is R/R?")
   * and the disclaimer wording.
   */
  isAuthenticated: boolean;
}

/** Six signal layers shown in the constellation context strip. Stable order matches the engine. */
const LAYER_ORDER: { key: AssistantLayerKey; abbr: string }[] = [
  { key: "technical", abbr: "TCH" },
  { key: "news", abbr: "NWS" },
  { key: "macro", abbr: "MAC" },
  { key: "sector", abbr: "SCT" },
  { key: "geopolitical", abbr: "GEO" },
  { key: "internals", abbr: "INT" }
];

function statusTone(status: AssistantLayerStatus | undefined): "bullish" | "bearish" | "neutral" | "unavailable" {
  if (status === "Bullish") return "bullish";
  if (status === "Bearish") return "bearish";
  if (status === "Neutral") return "neutral";
  return "unavailable";
}

function decisionContextTone(
  ctx: AssistantPageContext | null
): "neutral" | "bullish" | "bearish" | "caution" {
  if (!ctx?.decision_state) return "neutral";
  if (ctx.decision_state === "actionable") return "bullish";
  if (ctx.decision_state === "blocked") return "bearish";
  return "caution";
}

function buildQuickPrompts(
  ctx: AssistantPageContext | null,
  isAuthenticated: boolean
): string[] {
  if (!ctx) {
    if (!isAuthenticated) {
      return [
        "What is STOCVEST?",
        "How is STOCVEST different from signal-alert services?",
        "How do the six layers work together?",
        "Explain risk/reward in plain terms"
      ];
    }
    return [
      "What is STOCVEST?",
      "How do I read a signal decision?",
      "What's the difference between Monitor and Blocked?"
    ];
  }
  if (ctx.page === "signals/history") {
    return [
      "How do I read Signal State History?",
      "What does Alignment mean?",
      "What is the difference between Signal bias and a recommendation?"
    ];
  }
  const state = ctx.decision_state;
  if (state === "monitor") {
    return [
      "Why is this signal in Monitor?",
      "What would change this Decision?",
      "What does Alignment mean here?"
    ];
  }
  if (state === "blocked") {
    return [
      "Why is this signal Blocked?",
      "Which factor is the dominant block?",
      "What is risk/reward and why does it matter?"
    ];
  }
  if (state === "actionable") {
    return [
      "What confirms this Decision?",
      "What does six-layer agreement mean?",
      "How should I read Trade Readiness?"
    ];
  }
  return [
    "What is STOCVEST evaluating right now?",
    "What does Signal bias mean?",
    "How do the six layers work together?"
  ];
}

export const AssistantPanel = forwardRef<HTMLDivElement, AssistantPanelProps>(function AssistantPanel(
  { colors, context, messages, composerValue, setComposerValue, onSubmit, onClose, loading, notice, isAuthenticated },
  ref
) {
  const tone = decisionContextTone(context);
  const headingId = useId();
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);

  useEffect(() => {
    const el = conversationRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    function onEsc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const submit = useCallback(() => {
    const text = composerValue.trim();
    if (!text || loading) return;
    onSubmit(text);
  }, [composerValue, loading, onSubmit]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  const accentRing = tone === "bullish"
    ? "rgba(34,197,94,0.42)"
    : tone === "bearish"
      ? "rgba(239,68,68,0.45)"
      : tone === "caution"
        ? "rgba(245,158,11,0.45)"
        : "rgba(56,189,248,0.42)";

  const panelStyle: CSSProperties = {
    background:
      "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(13,21,38,0.88) 60%, rgba(11,19,34,0.92) 100%)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    border: `1px solid ${colors.border}`,
    boxShadow: `0 28px 60px rgba(2,6,23,0.55), 0 0 0 1px ${accentRing}, 0 0 40px ${accentRing}`,
    borderRadius: borderRadius.xl,
    width: "min(440px, calc(100vw - 24px))",
    maxHeight: "min(720px, 78vh)",
    display: "grid",
    gridTemplateRows: "auto auto 1fr auto",
    overflow: "hidden",
    color: colors.text
  };

  const isLightTheme = isLightSurface(colors.surface);
  const lightOverride: CSSProperties = isLightTheme
    ? {
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.92) 60%, rgba(241,245,249,0.95) 100%)"
      }
    : {};

  const showQuickPrompts = messages.length === 0 && !loading;
  const quickPrompts = useMemo(
    () => buildQuickPrompts(context, isAuthenticated),
    [context, isAuthenticated]
  );
  const mode: "general" | "contextual" = context ? "contextual" : "general";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      className="stocvest-assistant-panel"
      style={{ ...panelStyle, ...lightOverride }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[2],
          padding: `${spacing[3]} ${spacing[3]}`,
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id={headingId}
            style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}
          >
            STOCVEST Assistant
          </h2>
          <ModeBadge mode={mode} colors={colors} tone={tone} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close STOCVEST Assistant"
          style={{
            background: "transparent",
            border: "none",
            color: colors.textMuted,
            cursor: "pointer",
            padding: 4,
            borderRadius: borderRadius.md
          }}
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <ConstellationStrip context={context} colors={colors} />

      <div
        ref={conversationRef}
        style={{
          padding: `${spacing[3]} ${spacing[4]}`,
          overflowY: "auto",
          minHeight: 240,
          maxHeight: "100%"
        }}
      >
        {messages.length === 0 ? (
          <EmptyState colors={colors} context={context} isAuthenticated={isAuthenticated} />
        ) : (
          <AssistantConversationRail messages={messages} colors={colors} contextTone={tone} />
        )}
      </div>

      <div
        style={{
          padding: `${spacing[2]} ${spacing[3]} ${spacing[3]}`,
          borderTop: `1px solid ${colors.border}`,
          display: "grid",
          gap: spacing[2]
        }}
      >
        {notice ? (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            {notice}
          </p>
        ) : null}

        {showQuickPrompts ? (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: spacing[1]
            }}
          >
            {quickPrompts.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => onSubmit(q)}
                  disabled={loading}
                  style={{
                    border: `1px solid ${colors.border}`,
                    background: "rgba(56,189,248,0.06)",
                    color: colors.text,
                    borderRadius: borderRadius.full,
                    padding: "6px 12px",
                    fontSize: typography.scale.xs,
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.5 : 1
                  }}
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: spacing[2],
            border: `1px solid ${composerFocused ? colors.accent : colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[1],
            background: colors.surface,
            transition: "border-color 160ms ease"
          }}
        >
          <textarea
            value={composerValue}
            onChange={(e) => setComposerValue(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder={
              context
                ? "Ask about this screen — STOCVEST will explain, not advise."
                : "Ask how STOCVEST works."
            }
            rows={1}
            aria-label="Message STOCVEST Assistant"
            style={{
              flex: 1,
              minHeight: 36,
              maxHeight: 140,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: colors.text,
              fontSize: typography.scale.sm,
              lineHeight: 1.5,
              padding: `${spacing[1]} ${spacing[2]}`,
              fontFamily: "inherit"
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={loading || composerValue.trim().length === 0}
            aria-label="Send message"
            style={{
              minWidth: 36,
              minHeight: 36,
              borderRadius: borderRadius.md,
              border: "none",
              background: loading || composerValue.trim().length === 0 ? colors.surfaceMuted : colors.accent,
              color: loading || composerValue.trim().length === 0 ? colors.textMuted : "#0b1322",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: loading || composerValue.trim().length === 0 ? "default" : "pointer"
            }}
          >
            <Send size={14} aria-hidden />
          </button>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 10,
            color: colors.textMuted,
            letterSpacing: "0.04em",
            lineHeight: 1.5
          }}
        >
          STOCVEST Assistant explains analysis and decisions. It does not provide trading advice or
          price predictions.
        </p>
      </div>
    </div>
  );
});

function ModeBadge({
  mode,
  colors,
  tone
}: {
  mode: "general" | "contextual";
  colors: ThemeColors;
  tone: "neutral" | "bullish" | "bearish" | "caution";
}) {
  const isContextual = mode === "contextual";
  const accent = isContextual
    ? tone === "bullish"
      ? colors.bullish
      : tone === "bearish"
        ? colors.bearish
        : tone === "caution"
          ? colors.caution
          : colors.accent
    : colors.textMuted;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: borderRadius.full,
        border: `1px solid ${accent}55`,
        background: `${accent}14`,
        color: accent
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: accent,
          boxShadow: `0 0 6px ${accent}88`
        }}
      />
      {isContextual ? "Contextual" : "General"}
    </span>
  );
}

function ConstellationStrip({
  context,
  colors
}: {
  context: AssistantPageContext | null;
  colors: ThemeColors;
}) {
  if (!context) {
    return (
      <div
        style={{
          padding: `${spacing[2]} ${spacing[3]}`,
          fontSize: 10,
          color: colors.textMuted,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        General mode · STOCVEST product help
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderBottom: `1px solid ${colors.border}`,
        color: colors.textMuted,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase"
      }}
    >
      <span aria-label="Active context">Context</span>
      {context.symbol ? (
        <span
          style={{
            color: colors.text,
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.05em"
          }}
        >
          {context.symbol}
        </span>
      ) : null}
      {context.decision_state ? (
        <span style={{ color: colors.textMuted, fontSize: 10 }}>
          · {capitalize(context.decision_state)}
        </span>
      ) : null}
      <div
        role="group"
        aria-label="Signal layer constellation"
        style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        {LAYER_ORDER.map((layer) => {
          const status = context.layer_status?.[layer.key];
          const tone = statusTone(status);
          return (
            <span
              key={layer.key}
              title={`${capitalize(layer.key)}: ${status ?? "Unavailable"}`}
              data-tone={tone}
              className="stocvest-assistant-constellation-dot"
              aria-label={`${capitalize(layer.key)} ${status ?? "unavailable"}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({
  colors,
  context,
  isAuthenticated
}: {
  colors: ThemeColors;
  context: AssistantPageContext | null;
  isAuthenticated: boolean;
}) {
  /**
   * Three distinct empty-state surfaces:
   *
   *  - **Contextual** (any signed-in dashboard page that publishes a `page_context`):
   *    a one-line invitation tailored to the current Decision and metrics on screen.
   *
   *  - **Marketing / anonymous** (no auth, no context — `/`, `/login`, `/signup`):
   *    a welcoming pitch that explains in one paragraph *what* STOCVEST is and *how*
   *    it helps, followed by the kinds of questions the visitor can ask. This is the
   *    first impression for prospects, so it leads with the six-layer thesis instead
   *    of a generic "ask me anything" line.
   *
   *  - **Signed-in, no context** (logged-in user on a route that publishes no page
   *    context, e.g. they navigated to `/`): a calm "ask me anything" prompt that
   *    keeps the same trade-disclaimer footer.
   */
  if (context) {
    return (
      <div style={{ display: "grid", gap: spacing[2] }}>
        <p
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.55,
            fontWeight: 600
          }}
        >
          I can explain what&apos;s driving this Decision and how to read the layers.
        </p>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            lineHeight: 1.55
          }}
        >
          I explain analysis and product behavior. I never give trading advice or predict prices.
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ display: "grid", gap: spacing[2] }}>
        <p
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.55,
            fontWeight: 700
          }}
        >
          Welcome to STOCVEST.
        </p>
        <p
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.6
          }}
        >
          STOCVEST is a market analysis and decision-support platform. It evaluates every setup across six independent layers — technical, news, macro, sector, geopolitical, and internals — and only flags trades when they agree. I&apos;m here to explain how STOCVEST thinks, not to tell you what to do.
        </p>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            lineHeight: 1.55
          }}
        >
          Ask me what STOCVEST is, how it&apos;s different from signal-alert services, or for a plain-English explanation of any trading term (R/R, EMA, VWAP, ORB, expectancy, drawdown, position sizing — anything). I do not give trade recommendations or price predictions.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: spacing[2] }}>
      <p
        style={{
          margin: 0,
          color: colors.text,
          fontSize: typography.scale.sm,
          lineHeight: 1.55,
          fontWeight: 600
        }}
      >
        Ask about STOCVEST&apos;s analysis, Decisions, or anything on screen.
      </p>
      <p
        style={{
          margin: 0,
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          lineHeight: 1.55
        }}
      >
        I explain analysis and product behavior. I never give trading advice or predict prices.
      </p>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Crude check for whether the resolved surface color is light so the gradient can adapt. */
function isLightSurface(surface: string): boolean {
  const s = surface.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 6) {
      try {
        const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return r + g + b > 380; // ~light if average channel > ~127
      } catch {
        return false;
      }
    }
  }
  return false;
}

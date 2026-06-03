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
import { Mic, MicOff, Paperclip, Send, X } from "lucide-react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type {
  AssistantLayerKey,
  AssistantLayerStatus,
  AssistantMessage,
  AssistantPageContext,
  AttachedImage
} from "@/lib/assistant/types";
import { AssistantConversationRail } from "@/components/assistant/assistant-conversation-rail";
import { buildContextualQuickPrompts } from "@/lib/assistant/quick-prompts";
import { useVoiceInput } from "@/lib/hooks/use-voice-input";

interface AssistantPanelProps {
  colors: ThemeColors;
  context: AssistantPageContext | null;
  messages: AssistantMessage[];
  composerValue: string;
  setComposerValue: (next: string) => void;
  onSubmit: (text: string, image?: AttachedImage) => void;
  /** Send a refining message when the user taps a clarifying quick-reply chip. */
  onQuickReply?: (text: string) => void;
  onClose: () => void;
  loading: boolean;
  notice?: string | null;
  isAuthenticated: boolean;
}

const LAYER_ORDER: { key: AssistantLayerKey; abbr: string }[] = [
  { key: "technical", abbr: "T" },
  { key: "news", abbr: "N" },
  { key: "macro", abbr: "M" },
  { key: "sector", abbr: "S" },
  { key: "geopolitical", abbr: "G" },
  { key: "internals", abbr: "I" }
];

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

function statusTone(
  status: AssistantLayerStatus | undefined
): "bullish" | "bearish" | "neutral" | "unavailable" {
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

/** Convert a File to a base64 string (no data-URI prefix). */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:image/...;base64," prefix
      const base64 = result.split(",")[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const AssistantPanel = forwardRef<HTMLDivElement, AssistantPanelProps>(
  function AssistantPanel(
    {
      colors,
      context,
      messages,
      composerValue,
      setComposerValue,
      onSubmit,
      onQuickReply,
      onClose,
      loading,
      notice,
      isAuthenticated
    },
    ref
  ) {
    const tone = decisionContextTone(context);
    const headingId = useId();
    const conversationRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [composerFocused, setComposerFocused] = useState(false);
    const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [voiceError, setVoiceError] = useState<string | null>(null);

    // Auto-scroll conversation to bottom on new messages.
    useEffect(() => {
      const el = conversationRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, [messages]);

    // Escape closes the panel.
    useEffect(() => {
      function onEsc(e: globalThis.KeyboardEvent) {
        if (e.key === "Escape") onClose();
      }
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }, [onClose]);

    const { isRecording, isSupported: micSupported, toggle: toggleMic } = useVoiceInput({
      onTranscript: useCallback(
        (text: string) => {
          setComposerValue(composerValue ? composerValue + " " + text : text);
          setVoiceError(null);
          textareaRef.current?.focus();
        },
        [composerValue, setComposerValue]
      ),
      onError: useCallback((msg: string) => {
        setVoiceError(msg);
      }, [])
    });

    const submit = useCallback(() => {
      const text = composerValue.trim();
      if (!text || loading) return;
      onSubmit(text, attachedImage ?? undefined);
      setAttachedImage(null);
      setAttachError(null);
      setVoiceError(null);
    }, [composerValue, loading, onSubmit, attachedImage]);

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      },
      [submit]
    );

    const handleFileSelect = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        setAttachError(null);

        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          setAttachError("Only PNG, JPG, and WebP images are supported.");
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setAttachError("Image must be under 5 MB.");
          return;
        }
        try {
          const data = await fileToBase64(file);
          setAttachedImage({
            data,
            media_type: file.type as AttachedImage["media_type"],
            name: file.name
          });
        } catch {
          setAttachError("Failed to read image. Try again.");
        }
      },
      []
    );

    const accentRing =
      tone === "bullish"
        ? "rgba(34,197,94,0.38)"
        : tone === "bearish"
          ? "rgba(239,68,68,0.40)"
          : tone === "caution"
            ? "rgba(245,158,11,0.40)"
            : "rgba(56,189,248,0.35)";

    const panelStyle: CSSProperties = {
      background:
        "linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(13,21,38,0.92) 60%, rgba(11,19,34,0.95) 100%)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: `1px solid ${colors.border}`,
      boxShadow: `0 24px 56px rgba(2,6,23,0.6), 0 0 0 1px ${accentRing}`,
      borderRadius: borderRadius.xl,
      width: "min(420px, calc(100vw - 24px))",
      maxHeight: "min(680px, 80vh)",
      display: "grid",
      gridTemplateRows: "auto 1fr auto",
      overflow: "hidden",
      color: colors.text
    };

    const isLightTheme = isLightSurface(colors.surface);
    const lightOverride: CSSProperties = isLightTheme
      ? {
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(248,250,252,0.94) 100%)"
        }
      : {};

    const showQuickPrompts = messages.length === 0 && !loading;
    const quickPrompts = useMemo(
      () => buildContextualQuickPrompts(context, isAuthenticated).slice(0, 3),
      [context, isAuthenticated]
    );

    const canSend = composerValue.trim().length > 0 && !loading;
    const composerShellBorder = composerFocused
      ? colors.accent
      : `color-mix(in srgb, ${colors.accent} 40%, ${colors.border})`;
    const composerShellBg = composerFocused
      ? isLightTheme
        ? `color-mix(in srgb, ${colors.accent} 12%, ${colors.surface})`
        : `color-mix(in srgb, ${colors.accent} 10%, ${colors.surface})`
      : isLightTheme
        ? `color-mix(in srgb, ${colors.accent} 7%, ${colors.surface})`
        : `color-mix(in srgb, ${colors.accent} 8%, ${colors.surface})`;
    const composerTextareaBg = isLightTheme
      ? `color-mix(in srgb, ${colors.accent} 11%, #ffffff)`
      : `color-mix(in srgb, ${colors.accent} 16%, ${colors.surface})`;

    return (
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-labelledby={headingId}
        className="stocvest-assistant-panel"
        style={{ ...panelStyle, ...lightOverride }}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing[2],
            padding: `${spacing[3]} ${spacing[4]}`,
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
            <h2
              id={headingId}
              style={{
                margin: 0,
                fontSize: typography.scale.sm,
                fontWeight: 700,
                color: colors.text,
                whiteSpace: "nowrap"
              }}
            >
              STOCVEST Assistant
            </h2>
            {/* Compact context chip — replaces the full constellation strip */}
            {context?.symbol ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  padding: "2px 8px",
                  borderRadius: borderRadius.full,
                  background: `${colors.accent}18`,
                  border: `1px solid ${colors.accent}40`,
                  color: colors.accent,
                  whiteSpace: "nowrap"
                }}
              >
                {context.symbol.toUpperCase()}
              </span>
            ) : context ? (
              <LayerDots context={context} colors={colors} />
            ) : null}
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
              borderRadius: borderRadius.md,
              flexShrink: 0
            }}
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        {/* ── Conversation ──────────────────────────────────────────────── */}
        <div
          ref={conversationRef}
          style={{
            padding: `${spacing[3]} ${spacing[4]}`,
            overflowY: "auto",
            minHeight: 200
          }}
        >
          {messages.length === 0 ? (
            <EmptyState
              colors={colors}
              isAuthenticated={isAuthenticated}
              showQuickPrompts={showQuickPrompts}
              quickPrompts={quickPrompts}
              loading={loading}
              onPrompt={onSubmit}
            />
          ) : (
            <AssistantConversationRail
              messages={messages}
              colors={colors}
              contextTone={tone}
              loading={loading}
              onQuickReply={onQuickReply}
            />
          )}
        </div>

        {/* ── Composer ──────────────────────────────────────────────────── */}
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]} ${spacing[3]}`,
            borderTop: `1px solid ${colors.border}`,
            display: "grid",
            gap: spacing[2]
          }}
        >
          {/* Transient notices (upgrade prompt, errors) */}
          {(notice || attachError || voiceError) ? (
            <p
              role="status"
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                color: attachError || voiceError ? colors.bearish ?? colors.textMuted : colors.textMuted,
                lineHeight: 1.5
              }}
            >
              {attachError || voiceError || notice}
            </p>
          ) : null}

          {/* Attached image preview */}
          {attachedImage ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: spacing[2],
                padding: `${spacing[1]} ${spacing[2]}`,
                borderRadius: borderRadius.md,
                background: `${colors.accent}14`,
                border: `1px solid ${colors.accent}35`
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${attachedImage.media_type};base64,${attachedImage.data}`}
                alt="Attached"
                style={{
                  width: 36,
                  height: 36,
                  objectFit: "cover",
                  borderRadius: borderRadius.sm,
                  flexShrink: 0
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {attachedImage.name}
              </span>
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                aria-label="Remove attached image"
                style={{
                  background: "transparent",
                  border: "none",
                  color: colors.textMuted,
                  cursor: "pointer",
                  padding: 2,
                  borderRadius: borderRadius.sm,
                  flexShrink: 0
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          ) : null}

          {/* Main input row */}
          <div
            data-focused={composerFocused ? "true" : "false"}
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: spacing[1],
              padding: `${spacing[2]} ${spacing[2]}`,
              borderRadius: borderRadius.lg,
              border: `1.5px solid ${composerShellBorder}`,
              background: composerShellBg,
              boxShadow: composerFocused
                ? `0 0 0 3px color-mix(in srgb, ${colors.accent} 24%, transparent), 0 10px 24px color-mix(in srgb, ${colors.accent} 18%, transparent)`
                : `0 4px 14px color-mix(in srgb, ${colors.accent} 8%, transparent)`,
              transition: "border-color 150ms ease, box-shadow 150ms ease, background 150ms ease"
            }}
          >
            {/* Attachment button (+) */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              style={{ display: "none" }}
              onChange={handleFileSelect}
              aria-label="Attach image"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              title="Attach image (PNG, JPG, WebP · max 5 MB)"
              aria-label="Attach image"
              style={{
                background: "transparent",
                border: "none",
                color: attachedImage ? colors.accent : colors.textMuted,
                cursor: loading ? "default" : "pointer",
                minWidth: 40,
                minHeight: 40,
                padding: 0,
                borderRadius: borderRadius.sm,
                flexShrink: 0,
                opacity: loading ? 0.4 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Paperclip size={15} aria-hidden />
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              id="stocvest-assistant-composer-input"
              value={composerValue}
              onChange={(e) => setComposerValue(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              placeholder="Ask me anything about stocks…"
              rows={2}
              aria-label="Message STOCVEST Assistant"
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 140,
                resize: "none",
                border: `1px solid color-mix(in srgb, ${colors.accent} 35%, transparent)`,
                borderRadius: borderRadius.md,
                outline: "none",
                background: composerTextareaBg,
                color: colors.text,
                // 16px keeps the field readable and prevents iOS Safari's
                // auto-zoom on focus (which fires below 16px) on mobile.
                fontSize: 16,
                lineHeight: 1.55,
                padding: `${spacing[1]} ${spacing[2]}`,
                fontFamily: "inherit"
              }}
            />

            {/* Mic button */}
            <button
              type="button"
              onClick={toggleMic}
              disabled={loading || !micSupported}
              title={
                !micSupported
                  ? "Voice input · Chrome and Edge only · English"
                  : isRecording
                    ? "Stop recording"
                    : "Start voice input (English only)"
              }
              aria-label={isRecording ? "Stop voice input" : "Start voice input (English only)"}
              style={{
                background: isRecording ? `${colors.accent}22` : "transparent",
                border: isRecording ? `1px solid ${colors.accent}55` : "none",
                color: isRecording ? colors.accent : colors.textMuted,
                cursor: loading || !micSupported ? "default" : "pointer",
                minWidth: 40,
                minHeight: 40,
                padding: 0,
                borderRadius: borderRadius.sm,
                flexShrink: 0,
                opacity: !micSupported || loading ? 0.35 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 150ms ease, background 150ms ease"
              }}
            >
              {isRecording ? <MicOff size={15} aria-hidden /> : <Mic size={15} aria-hidden />}
            </button>

            {/* Send button */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
              style={{
                minWidth: 40,
                minHeight: 40,
                borderRadius: borderRadius.md,
                border: "none",
                background: canSend ? colors.accent : colors.surfaceMuted,
                color: canSend ? "#0b1322" : colors.textMuted,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canSend ? "pointer" : "default",
                flexShrink: 0,
                boxShadow: canSend
                  ? `0 3px 10px color-mix(in srgb, ${colors.accent} 30%, transparent)`
                  : "none",
                transition: "background 150ms ease, box-shadow 150ms ease"
              }}
            >
              <Send size={14} aria-hidden />
            </button>
          </div>

          {/* Recording indicator */}
          {isRecording ? (
            <p
              role="status"
              style={{
                margin: 0,
                fontSize: typography.scale.xs,
                color: colors.accent,
                display: "flex",
                alignItems: "center",
                gap: 6
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: colors.accent,
                  animation: "stocvest-assistant-pulse 1s ease-in-out infinite"
                }}
              />
              Listening… speak clearly in English
            </p>
          ) : null}

          {/* Disclaimer */}
          <p
            style={{
              margin: 0,
              fontSize: 10,
              color: colors.textMuted,
              letterSpacing: "0.02em",
              lineHeight: 1.4
            }}
          >
            Facts and analysis only — not trading advice.
          </p>
        </div>
      </div>
    );
  }
);

/** Six tiny status dots replacing the verbose constellation strip. */
function LayerDots({
  context,
  colors
}: {
  context: AssistantPageContext;
  colors: ThemeColors;
}) {
  return (
    <div
      role="group"
      aria-label="Signal layer status"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 }}
    >
      {LAYER_ORDER.map((layer) => {
        const status = context.layer_status?.[layer.key];
        const tone = statusTone(status);
        const dotColor =
          tone === "bullish"
            ? colors.bullish
            : tone === "bearish"
              ? colors.bearish
              : tone === "neutral"
                ? colors.textMuted
                : `${colors.textMuted}55`;
        return (
          <span
            key={layer.key}
            title={`${capitalize(layer.key)}: ${status ?? "Unavailable"}`}
            aria-label={`${capitalize(layer.key)} ${status ?? "unavailable"}`}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0
            }}
          />
        );
      })}
    </div>
  );
}

function EmptyState({
  colors,
  isAuthenticated,
  showQuickPrompts,
  quickPrompts,
  loading,
  onPrompt
}: {
  colors: ThemeColors;
  isAuthenticated: boolean;
  showQuickPrompts: boolean;
  quickPrompts: string[];
  loading: boolean;
  onPrompt: (text: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: spacing[3] }}>
      <p
        style={{
          margin: 0,
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          lineHeight: 1.6
        }}
      >
        {isAuthenticated
          ? "Ask about any stock — why it's moving, what analysts are saying, or what the signal engine shows."
          : "Ask what STOCVEST is, how it works, or for explanations of common trading terms."}
      </p>

      {showQuickPrompts && quickPrompts.length > 0 ? (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}
          role="list"
          aria-label="Suggested questions"
        >
          {quickPrompts.map((q) => (
            <button
              key={q}
              type="button"
              role="listitem"
              onClick={() => onPrompt(q)}
              disabled={loading}
              style={{
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.textMuted,
                borderRadius: borderRadius.full,
                padding: "6px 12px",
                fontSize: typography.scale.xs,
                lineHeight: 1.35,
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.5 : 1,
                textAlign: "left",
                transition: "border-color 120ms ease, color 120ms ease"
              }}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isLightSurface(surface: string): boolean {
  const s = surface.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 6) {
      try {
        const full =
          hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return r + g + b > 380;
      } catch {
        return false;
      }
    }
  }
  return false;
}

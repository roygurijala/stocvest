"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme-provider";
import { useAssistantContext } from "@/lib/assistant/context";
import type { AssistantChatResponse, AssistantMessage } from "@/lib/assistant/types";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

/**
 * Top-level mount for the STOCVEST Assistant. Anchored to the bottom-right corner of the
 * dashboard, it owns conversation state, the open/closed UI, and the network call. The
 * locked system prompt and tone rules live on the server; this component intentionally
 * holds nothing about how to answer — only the channel.
 */
const STORAGE_KEY = "stocvest_assistant_state_v1";
const MAX_MESSAGES_KEPT = 24;

interface PersistedState {
  open?: boolean;
  composer?: string;
  messages?: AssistantMessage[];
}

function readPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function writePersistedState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* sessionStorage may be unavailable in privacy modes */
  }
}

export function StocvestAssistant() {
  const { colors } = useTheme();
  const pageContext = useAssistantContext();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  /** Hydrate from sessionStorage so a refresh doesn't lose context, but never spans tabs. */
  useEffect(() => {
    const persisted = readPersistedState();
    if (!persisted) return;
    if (Array.isArray(persisted.messages)) {
      setMessages(
        persisted.messages
          .filter(
            (m): m is AssistantMessage =>
              !!m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
          )
          .map((m) => ({ ...m, fresh: false, pending: false }))
          .slice(-MAX_MESSAGES_KEPT)
      );
    }
    if (typeof persisted.composer === "string") {
      setComposerValue(persisted.composer);
    }
  }, []);

  /** Persist on change. We don't persist `open` — every load starts collapsed for calm. */
  useEffect(() => {
    writePersistedState({
      composer: composerValue,
      messages: messages.map((m) => ({ ...m, fresh: false, pending: false }))
    });
  }, [composerValue, messages]);

  const close = useCallback(() => {
    setOpen(false);
    setHasUnread(false);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) setHasUnread(false);
      return next;
    });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setNotice(null);

      const userId = `u-${Date.now()}`;
      const pendingId = `a-${Date.now() + 1}`;
      const userMsg: AssistantMessage = { id: userId, role: "user", content: trimmed };
      const pendingMsg: AssistantMessage = {
        id: pendingId,
        role: "assistant",
        content: "",
        pending: true
      };
      const nextMessages: AssistantMessage[] = [
        ...messages.map((m) => ({ ...m, fresh: false })),
        userMsg,
        pendingMsg
      ].slice(-MAX_MESSAGES_KEPT);
      setMessages(nextMessages);
      setComposerValue("");
      setLoading(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/stocvest/signals/assistant/chat", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: nextMessages
              .filter((m) => !m.pending)
              .map((m) => ({ role: m.role, content: m.content })),
            page_context: pageContext ?? null
          })
        });

        if (surfaceAuthErrorIfAny(res)) {
          setMessages((cur) => cur.filter((m) => m.id !== pendingId));
          return;
        }

        const data = (await res.json().catch(() => ({}))) as Partial<AssistantChatResponse>;
        if (!res.ok || typeof data.text !== "string" || !data.text) {
          setMessages((cur) =>
            cur.map((m) =>
              m.id === pendingId
                ? {
                    ...m,
                    pending: false,
                    fresh: false,
                    content:
                      "I couldn't reach the explanation service. The Decision line and column tooltips on screen carry the authoritative reasoning."
                  }
                : m
            )
          );
          return;
        }

        setMessages((cur) =>
          cur.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  pending: false,
                  fresh: true,
                  mode: data.mode === "contextual" ? "contextual" : "general",
                  content: data.text!
                }
              : { ...m, fresh: false }
          )
        );
        if (data.upgrade_available) {
          setNotice(
            "Conversational, page-aware explanations are part of Swing Pro. Free accounts see general product help."
          );
        }
        if (!open) setHasUnread(true);
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          setMessages((cur) =>
            cur.map((m) =>
              m.id === pendingId
                ? {
                    ...m,
                    pending: false,
                    fresh: false,
                    content:
                      "I couldn't reach the explanation service right now. Please try again in a moment."
                  }
                : m
            )
          );
        } else {
          setMessages((cur) => cur.filter((m) => m.id !== pendingId));
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, open, pageContext]
  );

  const decisionDotColor = useMemo<string | undefined>(() => {
    const state = pageContext?.decision_state;
    if (state === "actionable") return colors.bullish;
    if (state === "blocked") return colors.bearish;
    if (state === "monitor") return colors.caution;
    return undefined;
  }, [pageContext?.decision_state, colors.bullish, colors.bearish, colors.caution]);

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        display: "grid",
        gap: 12,
        justifyItems: "end",
        pointerEvents: "none"
      }}
      aria-live="polite"
    >
      {open ? (
        <div style={{ pointerEvents: "auto" }}>
          <AssistantPanel
            colors={colors}
            context={pageContext}
            messages={messages}
            composerValue={composerValue}
            setComposerValue={setComposerValue}
            onSubmit={submit}
            onClose={close}
            loading={loading}
            notice={notice}
          />
        </div>
      ) : null}
      <div style={{ pointerEvents: "auto" }}>
        <AssistantLauncher
          open={open}
          onToggle={toggle}
          colors={colors}
          contextDotColor={decisionDotColor}
          hasUnread={hasUnread}
        />
      </div>
    </div>
  );
}

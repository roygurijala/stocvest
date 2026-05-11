"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme-provider";
import { useAssistantContext } from "@/lib/assistant/context";
import {
  ASSISTANT_STORAGE_KEY,
  clearAssistantSession,
  subscribeAssistantReset
} from "@/lib/assistant/session-reset";
import type { AssistantChatResponse, AssistantMessage } from "@/lib/assistant/types";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import { subscribeSessionExpired } from "@/lib/auth/session-expired";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantPanel } from "@/components/assistant/assistant-panel";

/**
 * Top-level mount for the STOCVEST Assistant. Anchored to the bottom-right corner of the
 * dashboard, it owns conversation state, the open/closed UI, and the network call. The
 * locked system prompt and tone rules live on the server; this component intentionally
 * holds nothing about how to answer — only the channel.
 *
 * Auth-aware: `isAuthenticated` is computed server-side in the root layout from the
 * session cookie. It selects which BFF endpoint to call:
 *   - authenticated → `/api/stocvest/signals/assistant/chat` (JWT-protected, paid tier
 *     gating + page context honored)
 *   - anonymous     → `/api/stocvest/public/assistant/chat` (no auth, public-mode prompt;
 *     no page context — marketing visitors have no STOCVEST page state)
 *
 * Cross-page context isolation: the page identifier the conversation belongs to is
 * persisted alongside messages. When the active page changes (e.g. user navigates from
 * Signals to Dashboard), the conversation is reset so an answer about TTD on Signals
 * never leaks into a Dashboard-page question. The same reset runs on logout, on session
 * expiry, and whenever the auth state flips — keeping every visitor's conversation
 * scoped to a single page identity.
 */
const MAX_MESSAGES_KEPT = 24;

interface PersistedState {
  open?: boolean;
  composer?: string;
  messages?: AssistantMessage[];
  lastPage?: string | null;
  isAuthenticated?: boolean;
}

function readPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ASSISTANT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function writePersistedState(state: PersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* sessionStorage may be unavailable in privacy modes */
  }
}

interface StocvestAssistantProps {
  /**
   * Server-rendered flag: was a session cookie present when the request was served?
   * The assistant uses this to pick the authenticated vs. public BFF endpoint and to
   * clear conversation history when the auth state flips (login or logout).
   */
  isAuthenticated: boolean;
}

export function StocvestAssistant({ isAuthenticated }: StocvestAssistantProps) {
  const { colors } = useTheme();
  const pageContext = useAssistantContext();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  /**
   * The page identifier the persisted conversation belongs to. Updated whenever a
   * different page publishes context; compared against the active page on every
   * navigation so a mismatch triggers a fresh-conversation reset. Stored in a ref
   * because it must be readable from inside both the page-change effect and the
   * persist effect without causing an extra re-render.
   */
  const conversationPageRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const prevAuthRef = useRef<boolean | null>(null);

  /** Hydrate from sessionStorage so a refresh doesn't lose context, but never spans tabs. */
  useEffect(() => {
    const persisted = readPersistedState();
    if (persisted) {
      // Drop persisted state if the auth state has flipped since persistence. Switching
      // from signed-in → signed-out (or vice versa) is treated as a fresh visitor.
      const persistedAuth =
        typeof persisted.isAuthenticated === "boolean" ? persisted.isAuthenticated : null;
      if (persistedAuth !== null && persistedAuth !== isAuthenticated) {
        try {
          window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      } else {
        if (Array.isArray(persisted.messages)) {
          setMessages(
            persisted.messages
              .filter(
                (m): m is AssistantMessage =>
                  !!m &&
                  typeof m.id === "string" &&
                  (m.role === "user" || m.role === "assistant") &&
                  typeof m.content === "string"
              )
              .map((m) => ({ ...m, fresh: false, pending: false }))
              .slice(-MAX_MESSAGES_KEPT)
          );
        }
        if (typeof persisted.composer === "string") {
          setComposerValue(persisted.composer);
        }
        if (typeof persisted.lastPage === "string") {
          conversationPageRef.current = persisted.lastPage;
        }
      }
    }
    hydratedRef.current = true;
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated]);

  /**
   * Page-change detection: the moment the published page identifier differs from the
   * one the persisted conversation belongs to, wipe the messages so the LLM never sees
   * a prior page's history. Null transitions (between unmount cleanup and the next
   * publisher's effect) are deliberately ignored.
   */
  useEffect(() => {
    if (!hydratedRef.current) return;
    const currentPage = pageContext?.page ?? null;
    if (currentPage === null) return;
    if (
      conversationPageRef.current !== null &&
      conversationPageRef.current !== currentPage
    ) {
      setMessages([]);
      setComposerValue("");
      setNotice(null);
      setHasUnread(false);
    }
    conversationPageRef.current = currentPage;
  }, [pageContext?.page]);

  /**
   * Auth-state change (login or logout): always reset. The session-expiry watcher and
   * the explicit logout-button `onClick` cover the typical paths, but this also catches
   * cases where the server re-renders with a flipped session without firing those
   * channels (e.g. cookie cleared by middleware).
   */
  useEffect(() => {
    if (prevAuthRef.current === null) {
      prevAuthRef.current = isAuthenticated;
      return;
    }
    if (prevAuthRef.current === isAuthenticated) return;
    prevAuthRef.current = isAuthenticated;
    setMessages([]);
    setComposerValue("");
    setNotice(null);
    setHasUnread(false);
    setOpen(false);
    conversationPageRef.current = null;
    try {
      window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [isAuthenticated]);

  /**
   * Reactive subscriptions: session-expiry (token expired or a 401 surfaced from any
   * fetch) and the explicit `clearAssistantSession()` event from logout buttons. Both
   * wipe everything visible.
   */
  useEffect(() => {
    const handleReset = () => {
      setMessages([]);
      setComposerValue("");
      setNotice(null);
      setHasUnread(false);
      setOpen(false);
      conversationPageRef.current = null;
    };
    const unsubExpiry = subscribeSessionExpired(handleReset);
    const unsubReset = subscribeAssistantReset(handleReset);
    return () => {
      unsubExpiry();
      unsubReset();
    };
  }, []);

  /** Persist on change. We don't persist `open` — every load starts collapsed for calm. */
  useEffect(() => {
    if (!hydratedRef.current) return;
    writePersistedState({
      composer: composerValue,
      messages: messages.map((m) => ({ ...m, fresh: false, pending: false })),
      lastPage: conversationPageRef.current,
      isAuthenticated
    });
  }, [composerValue, messages, isAuthenticated, pageContext?.page]);

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

      // Endpoint selection is the only place auth state directly affects what the
      // assistant does: anonymous → public/no-context handler; authenticated →
      // contextual handler with full page-context payload.
      const endpoint = isAuthenticated
        ? "/api/stocvest/signals/assistant/chat"
        : "/api/stocvest/public/assistant/chat";
      const body = isAuthenticated
        ? {
            messages: nextMessages
              .filter((m) => !m.pending)
              .map((m) => ({ role: m.role, content: m.content })),
            page_context: pageContext ?? null
          }
        : {
            messages: nextMessages
              .filter((m) => !m.pending)
              .map((m) => ({ role: m.role, content: m.content }))
          };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body)
        });

        if (isAuthenticated && surfaceAuthErrorIfAny(res)) {
          setMessages((cur) => cur.filter((m) => m.id !== pendingId));
          return;
        }

        const data = (await res.json().catch(() => ({}))) as Partial<AssistantChatResponse>;
        if (!res.ok || typeof data.text !== "string" || !data.text) {
          if (typeof console !== "undefined") {
            // eslint-disable-next-line no-console
            console.warn(
              `[STOCVEST Assistant] chat request failed status=${res.status} body=${JSON.stringify(data).slice(0, 200)}`
            );
          }
          const fallbackText =
            res.status === 404
              ? "The STOCVEST Assistant isn't enabled in this environment yet. It will become available after the next deploy."
              : res.status >= 500
                ? "The explanation service is temporarily unavailable. Please try again in a moment."
                : "I couldn't reach the explanation service. Please try again in a moment.";
          setMessages((cur) =>
            cur.map((m) =>
              m.id === pendingId
                ? {
                    ...m,
                    pending: false,
                    fresh: false,
                    content: fallbackText
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
        if (data.upgrade_available && isAuthenticated) {
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
    [loading, messages, open, pageContext, isAuthenticated]
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
            isAuthenticated={isAuthenticated}
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

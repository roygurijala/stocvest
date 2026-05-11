"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/theme-provider";
import { useAssistantContext } from "@/lib/assistant/context";
import {
  ASSISTANT_STORAGE_KEY,
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
 * Cross-surface conversation isolation: the reset signal is the URL **pathname**, not the
 * published page context. The pathname always changes on a real navigation, even when
 * the destination is a route that publishes no page context at all (the marketing home
 * page `/`, `/login`, `/signup`, etc.). The moment the pathname changes, the persisted
 * conversation is wiped — so an answer about TTD on `/dashboard/signals/layers` never
 * leaks into a question on `/dashboard`, `/dashboard/scanner`, or `/`. Auth-state flips,
 * session expiry, and explicit logout clicks all also wipe the state.
 */
const MAX_MESSAGES_KEPT = 24;

interface PersistedState {
  open?: boolean;
  composer?: string;
  messages?: AssistantMessage[];
  /** Pathname (e.g. `/dashboard/signals/layers`) the conversation was anchored to. */
  lastPathname?: string | null;
  /** Auth state at persist time; legacy persisted state from before this field existed
   *  is now treated as a force-clear so stale logged-in conversations cannot show up
   *  on the anonymous home page. */
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

function removePersistedState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    /* ignore */
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
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  /**
   * Pathname the persisted conversation belongs to. A useRef is used so the persist
   * effect can read the latest value without re-rendering on every navigation.
   */
  const conversationPathRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const prevAuthRef = useRef<boolean | null>(null);

  /**
   * Hydrate from sessionStorage so a refresh doesn't lose context, but never spans tabs.
   * Three force-clear conditions, any of which wipe persisted state on first render:
   *
   *  1. `persisted.isAuthenticated` is missing (legacy data from a build before that
   *     field was written) — we cannot know whether it belonged to a logged-in or
   *     anonymous session, so the safe move is to start fresh.
   *  2. `persisted.isAuthenticated` was a different value than the current session.
   *  3. `persisted.lastPathname` differs from the current pathname (the user refreshed
   *     on a different surface than the one the conversation was about).
   */
  useEffect(() => {
    const persisted = readPersistedState();
    if (persisted) {
      const persistedAuth =
        typeof persisted.isAuthenticated === "boolean" ? persisted.isAuthenticated : null;
      const persistedPath =
        typeof persisted.lastPathname === "string" ? persisted.lastPathname : null;
      const authMismatch = persistedAuth !== isAuthenticated;
      const pathMismatch =
        persistedPath !== null && pathname !== null && persistedPath !== pathname;
      if (authMismatch || pathMismatch) {
        removePersistedState();
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
        if (persistedPath) {
          conversationPathRef.current = persistedPath;
        }
      }
    }
    if (pathname) conversationPathRef.current = pathname;
    hydratedRef.current = true;
    prevAuthRef.current = isAuthenticated;
    // Hydrate runs once per session; `pathname` and `isAuthenticated` are intentionally
    // included so a server-side prop flip (e.g. middleware-driven logout) re-evaluates.
  }, [isAuthenticated, pathname]);

  /**
   * Pathname-based reset: every URL change wipes the conversation so the next question
   * is answered against the new surface only. This is the **primary** cross-surface
   * isolation — using the URL means we catch routes that publish no page context
   * (`/`, `/login`, `/signup`, marketing surfaces) just as well as routes that do.
   */
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!pathname) return;
    if (conversationPathRef.current === pathname) return;
    if (conversationPathRef.current !== null) {
      setMessages([]);
      setComposerValue("");
      setNotice(null);
      setHasUnread(false);
    }
    conversationPathRef.current = pathname;
  }, [pathname]);

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
    conversationPathRef.current = pathname ?? null;
    removePersistedState();
  }, [isAuthenticated, pathname]);

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
      conversationPathRef.current = pathname ?? null;
    };
    const unsubExpiry = subscribeSessionExpired(handleReset);
    const unsubReset = subscribeAssistantReset(handleReset);
    return () => {
      unsubExpiry();
      unsubReset();
    };
  }, [pathname]);

  /** Persist on change. We don't persist `open` — every load starts collapsed for calm. */
  useEffect(() => {
    if (!hydratedRef.current) return;
    writePersistedState({
      composer: composerValue,
      messages: messages.map((m) => ({ ...m, fresh: false, pending: false })),
      lastPathname: conversationPathRef.current,
      isAuthenticated
    });
  }, [composerValue, messages, isAuthenticated, pathname]);

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

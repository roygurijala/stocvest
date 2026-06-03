"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/theme-provider";
import { useAssistantContext } from "@/lib/assistant/context";
import {
  ASSISTANT_STORAGE_KEY,
  subscribeAssistantReset
} from "@/lib/assistant/session-reset";
import type { AssistantChatResponse, AssistantMessage, AttachedImage } from "@/lib/assistant/types";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";
import { subscribeSessionExpired } from "@/lib/auth/session-expired";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AppOverlayScrim } from "@/components/app-overlay-scrim";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";

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
 * Conversation isolation (in-memory only — no sessionStorage):
 *   - Refresh / hard reload → fresh state (mount = empty conversation).
 *   - Cross-surface navigation (`/dashboard/signals/layers` → `/`) → fresh state.
 *   - Auth-state flip (login or logout) → fresh state, even when the pathname does not
 *     change (e.g. a sign-in modal on `/`).
 *   - Session expiry / explicit logout-button click → fresh state via the
 *     `clearAssistantSession()` event channel.
 *
 * We intentionally do NOT persist the conversation across page loads. The prior
 * `sessionStorage`-backed design caused two regressions:
 *   1. On refresh, stale conversation re-appeared even when the user expected a clean
 *      surface.
 *   2. On in-place login (auth flip without navigation), the hydrate effect was
 *      clobbering the `prevAuthRef` that the auth-change reset effect depended on, so
 *      homepage public-mode messages survived into the authenticated context. The
 *      simplest, safest fix is to remove the persistence layer entirely so no stale
 *      state can survive any kind of transition.
 *
 * Legacy `sessionStorage` data (from before this change) is opportunistically wiped on
 * mount so existing tabs do not display stale messages either.
 */
const MAX_MESSAGES_KEPT = 24;

function wipeLegacyPersistedState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    /* sessionStorage may be unavailable in privacy modes — nothing to clean up. */
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
  const mobileLayout = useIsMobileLayout();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [composerValue, setComposerValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  /**
   * Last pathname this component saw. Used to detect cross-surface navigations and
   * reset the conversation when the URL changes. Initialized to `null` so the very
   * first effect run (mount) records the current pathname without firing a reset.
   */
  const conversationPathRef = useRef<string | null>(null);

  /**
   * Last auth state this component saw. Used to detect login / logout transitions.
   * Initialized to `null` so the very first effect run records the current auth state
   * without firing a reset.
   */
  const prevAuthRef = useRef<boolean | null>(null);

  /**
   * One-shot mount effect: wipe any legacy persisted state from older builds and make
   * sure the conversation does not rehydrate from `sessionStorage`. Every page load is
   * a fresh conversation by design.
   */
  useEffect(() => {
    wipeLegacyPersistedState();
  }, []);

  /**
   * Pathname-based reset: every URL change wipes the conversation so the next question
   * is answered against the new surface only. Using the pathname catches routes that
   * publish no page context (`/`, `/login`, `/signup`, etc.) just as reliably as routes
   * that do. On first render, `conversationPathRef.current` is `null`, so the mount
   * itself just records the current pathname without firing a reset.
   */
  useEffect(() => {
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
   * channels — for example a sign-in modal on the marketing surface that flips auth
   * without changing the pathname.
   *
   * On first render `prevAuthRef.current` is `null`, so the mount itself just records
   * the current auth state without firing a reset. This ref is owned exclusively by
   * this effect — no other effect writes to it — so the auth-flip detection is reliable.
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
    wipeLegacyPersistedState();
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
    async (text: string, attachedImage?: AttachedImage) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setNotice(null);

      const userId = `u-${Date.now()}`;
      const pendingId = `a-${Date.now() + 1}`;
      const userMsg: AssistantMessage = {
        id: userId,
        role: "user",
        content: trimmed,
        attachedImage
      };
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

      const endpoint = isAuthenticated
        ? "/api/stocvest/signals/assistant/chat"
        : "/api/stocvest/public/assistant/chat";
      const body: Record<string, unknown> = {
        messages: nextMessages
          .filter((m) => !m.pending)
          .map((m) => ({ role: m.role, content: m.content })),
        page_context: pageContext ?? null
      };
      // Forward image to backend only on the authenticated path.
      if (isAuthenticated && attachedImage) {
        body.attached_image = {
          data: attachedImage.data,
          media_type: attachedImage.media_type
        };
      }

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(body)
        });

        if (isAuthenticated && (await surfaceAuthErrorIfAny(res))) {
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
    <>
      <AppOverlayScrim
        open={open}
        variant={mobileLayout ? "assistant-mobile" : "assistant-desktop"}
        onClose={mobileLayout ? close : undefined}
        lockScroll={mobileLayout}
        zIndex={59}
        testId="assistant-overlay-scrim"
      />
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
            onSubmit={(text, image) => submit(text, image)}
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
    </>
  );
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { AssistantPageContext } from "@/lib/assistant/types";

interface AssistantContextValue {
  /** Latest page context published by the active page, or null in general mode. */
  context: AssistantPageContext | null;
  /** Imperative setter used by `usePublishAssistantContext`. */
  setContext: (next: AssistantPageContext | null) => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  context: null,
  setContext: () => {}
});

export function AssistantContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<AssistantPageContext | null>(null);
  const setContext = useCallback((next: AssistantPageContext | null) => {
    setCtx(next);
  }, []);
  const value = useMemo(() => ({ context: ctx, setContext }), [ctx, setContext]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistantContext(): AssistantPageContext | null {
  return useContext(AssistantContext).context;
}

/**
 * Page-side hook: publishes the supplied context to the global Assistant provider while
 * the page is mounted, and clears it on unmount. A content-keyed ref is used so callers
 * may pass freshly built objects each render without spuriously re-firing the effect.
 */
export function usePublishAssistantContext(ctx: AssistantPageContext | null): void {
  const { setContext } = useContext(AssistantContext);
  const lastKey = useRef<string>("");
  const stableKey = ctx ? safeStringify(ctx) : "null";
  useEffect(() => {
    if (stableKey === lastKey.current) return;
    lastKey.current = stableKey;
    setContext(ctx);
  }, [stableKey, ctx, setContext]);
  useEffect(() => {
    return () => {
      lastKey.current = "";
      setContext(null);
    };
  }, [setContext]);
}

/** JSON stringify for dependency comparison; falls back to a stable token on errors. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "unstringifiable";
  }
}

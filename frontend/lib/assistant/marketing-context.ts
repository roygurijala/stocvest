import type { AssistantPageContext } from "@/lib/assistant/types";

export type MarketingAssistantPage =
  | "home"
  | "about"
  | "how-it-works"
  | "performance"
  | "signup"
  | "login"
  | "security"
  | "terms"
  | "privacy";

const PATH_TO_MARKETING_PAGE: Record<string, MarketingAssistantPage> = {
  "/": "home",
  "/about": "about",
  "/how-it-works": "how-it-works",
  "/performance": "performance",
  "/signup": "signup",
  "/signup/agreements": "signup",
  "/login": "login",
  "/security": "security",
  "/terms": "terms",
  "/privacy": "privacy"
};

/** Map a public marketing pathname to assistant context (or null if not marketing). */
export function marketingPageFromPathname(pathname: string | null): MarketingAssistantPage | null {
  if (!pathname) return null;
  return PATH_TO_MARKETING_PAGE[pathname] ?? null;
}

/** Whitelisted public assistant context — no symbol or decision fields. */
export function buildMarketingAssistantContext(page: MarketingAssistantPage): AssistantPageContext {
  return {
    page: `marketing/${page}`,
    session_mode: "public"
  };
}

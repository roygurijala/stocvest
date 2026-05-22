"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import {
  buildMarketingAssistantContext,
  marketingPageFromPathname
} from "@/lib/assistant/marketing-context";

type Props = {
  isAuthenticated: boolean;
};

/**
 * Publishes whitelisted marketing assistant context for logged-out visitors on public
 * surfaces so the public chat path can answer product, pricing, and framework questions.
 */
export function MarketingAssistantContext({ isAuthenticated }: Props) {
  const pathname = usePathname();
  const ctx = useMemo(() => {
    if (isAuthenticated) return null;
    const page = marketingPageFromPathname(pathname);
    if (!page) return null;
    return buildMarketingAssistantContext(page);
  }, [isAuthenticated, pathname]);

  usePublishAssistantContext(ctx);
  return null;
}

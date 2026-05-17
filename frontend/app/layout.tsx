import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BodyScrollResetOnNavigate } from "@/components/body-scroll-reset";
import { StocvestAssistant } from "@/components/assistant/stocvest-assistant";
import { CrispChat } from "@/components/crisp-chat";
import { GlobalDisclaimer } from "@/components/global-disclaimer";
import { AssistantContextProvider } from "@/lib/assistant/context";
import { getServerSession } from "@/lib/auth/session";
import { StocvestSwrProvider } from "@/lib/swr/provider";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "STOCVEST",
  description: "Multi-broker swing and day trading platform",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const session = getServerSession();
  const crispUserEmail = session?.email ?? null;
  const isAuthenticated = session !== null;

  /**
   * The STOCVEST Assistant mounts at the root for **every** visitor — including anonymous
   * marketing-surface traffic on `/`, `/login`, `/signup`, etc. — so prospects can ask
   * what STOCVEST is, how it differs from signal-alert services, and for general finance
   * and trading term explanations. The active session is passed as a flag so the
   * assistant picks the right BFF endpoint (authenticated vs. public) and clears any
   * persisted conversation when the auth state flips. The locked system prompt enforces
   * the no-trade-advice / no-prediction / no-proprietary-logic rules on both paths.
   *
   * CrispChat (third-party support) stays mounted globally so users still have a manned
   * support path; the two chat surfaces are intentionally separate (CrispChat = humans,
   * STOCVEST Assistant = product behavior explanations).
   */
  const appBody = <div className="app-shell min-h-screen">{children}</div>;

  return (
    <html lang="en" className="theme-dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <StocvestSwrProvider>
            <BodyScrollResetOnNavigate />
            <CrispChat userEmail={crispUserEmail} />
            <AssistantContextProvider>
              {appBody}
              <StocvestAssistant isAuthenticated={isAuthenticated} />
            </AssistantContextProvider>
            <GlobalDisclaimer />
          </StocvestSwrProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

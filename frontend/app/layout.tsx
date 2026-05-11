import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { StocvestAssistant } from "@/components/assistant/stocvest-assistant";
import { CrispChat } from "@/components/crisp-chat";
import { GlobalDisclaimer } from "@/components/global-disclaimer";
import { AssistantContextProvider } from "@/lib/assistant/context";
import { getServerSession } from "@/lib/auth/session";
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

  /**
   * The STOCVEST Assistant is a paid product feature with a JWT-authenticated backend route.
   * We mount it (and its context provider) at the root so logged-in users get the assistant on
   * every route — dashboard, settings, marketing pages they navigate back to, etc. — but skip
   * the mount entirely for anonymous visitors so the unauthenticated home/landing/login/signup
   * surface is not exposed to client-side calls that would just 401. CrispChat (third-party
   * support) stays mounted globally so anonymous prospects still have a chat path.
   */
  const appBody = (
    <div className="app-shell flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
    </div>
  );

  return (
    <html lang="en" className="theme-dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <CrispChat userEmail={crispUserEmail} />
          {session ? (
            <AssistantContextProvider>
              {appBody}
              <StocvestAssistant />
            </AssistantContextProvider>
          ) : (
            appBody
          )}
          <GlobalDisclaimer />
        </ThemeProvider>
      </body>
    </html>
  );
}

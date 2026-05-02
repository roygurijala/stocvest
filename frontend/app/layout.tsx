import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CrispChat } from "@/components/crisp-chat";
import { DisclaimerFooter } from "@/components/disclaimer-footer";
import { getServerSession } from "@/lib/auth/session";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "STOCVEST",
  description: "Multi-broker swing and day trading platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const session = getServerSession();
  const crispUserEmail = session?.email ?? null;

  return (
    <html lang="en" className="theme-dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <CrispChat userEmail={crispUserEmail} />
          <div className="app-shell flex min-h-screen flex-col">
            <div className="flex-1">{children}</div>
            <DisclaimerFooter />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

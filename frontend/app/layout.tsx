import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "STOCVEST",
  description: "Multi-broker swing and day trading platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="theme-dark" data-theme="dark">
      <body>
        <ThemeProvider>
          <div className="app-shell">
            <header className="app-topbar">
              <ThemeToggle />
            </header>
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
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
          <div className="app-shell">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}

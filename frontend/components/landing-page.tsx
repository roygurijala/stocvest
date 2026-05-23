"use client";

import Link from "next/link";
import { useScrollPosition } from "@/lib/hooks/use-scroll-position";
import { StocvestLogo } from "@/components/brand/stocvest-logo";
import { LandingFitSection } from "@/components/landing/landing-fit-section";
import { LandingHeroSearch } from "@/components/landing/landing-hero-search";
import { LandingPhilosophySection } from "@/components/landing/landing-philosophy-section";
import { LandingProductDemoSection } from "@/components/landing/landing-product-demo-section";
import { LandingSignupSection } from "@/components/landing/landing-signup-section";
import type { LandingSignal } from "@/lib/api/landing-signals";
import type { PerformanceSummary } from "@/lib/api/public-signals";

export type LandingPageProps = {
  explorerSignals: LandingSignal[];
  activitySignals: LandingSignal[];
  usedApiFallback: boolean;
  performanceSummary: PerformanceSummary;
  foundingMemberCount: number | null;
};

export function LandingPage({
  explorerSignals: _explorerSignals,
  activitySignals: _activitySignals,
  usedApiFallback: _usedApiFallback,
  performanceSummary: _performanceSummary,
  foundingMemberCount: _foundingMemberCount
}: LandingPageProps) {
  const isScrolled = useScrollPosition(24);

  return (
    <main className="bg-[#070d18] text-slate-100">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${isScrolled ? "border-b border-white/10 bg-[#070d18]/95 backdrop-blur" : "bg-transparent"}`}
        data-testid="landing-header"
      >
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <StocvestLogo variant="landingNav" href="/" priority className="shrink-0" />
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/login" className="rounded-md border border-white/20 px-4 py-2 text-sm hover:border-white/40">
              Login
            </Link>
            <Link href="/signup/agreements" className="rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white">
              Start Free
            </Link>
          </div>
        </nav>
      </header>

      <LandingHeroSearch />
      <LandingProductDemoSection />
      <LandingPhilosophySection />
      <LandingFitSection />
      <LandingSignupSection />

      <footer className="border-t border-white/10 px-4 py-10 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-6">
          <StocvestLogo variant="footer" href="/" />
          <div className="flex w-full flex-col items-center gap-3 text-sm text-slate-400 md:flex-row md:justify-between">
            <span>Copyright 2026 STOCVEST LLC</span>
            <div className="flex max-w-full flex-wrap justify-center gap-x-4 gap-y-2">
              <Link href="/about">About</Link>
              <Link href="/how-it-works">How It Works</Link>
              <Link href="/performance">Performance</Link>
              <Link href="/security">Security</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
              <span>Not investment advice</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

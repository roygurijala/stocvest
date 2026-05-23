import Link from "next/link";
import { type MouseEvent, useState } from "react";
import { isPaidCheckoutEnabled } from "@/lib/feature-flags";

type PricingTier = "free" | "swing_pro" | "swing_day_pro";

export function LandingSignupSection() {
  const paidCheckout = isPaidCheckoutEnabled();
  const [pricingTier, setPricingTier] = useState<PricingTier>("swing_pro");

  const onPricingCardClick = (e: MouseEvent<HTMLDivElement>, tier: PricingTier) => {
    if ((e.target as HTMLElement).closest("a[href]")) return;
    setPricingTier(tier);
  };

  const pricingCardClass = (tier: PricingTier) =>
    [
      "landing-pricing-card flex h-full cursor-pointer flex-col p-6 text-left outline-none transition-[transform,box-shadow] duration-200",
      "focus-visible:ring-2 focus-visible:ring-cyan-400/90 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d18]",
      pricingTier === tier ? "landing-pricing-card--selected" : ""
    ].join(" ");

  if (!paidCheckout) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 text-center md:px-8 md:py-24" data-testid="landing-signup-section">
        <h2 className="text-2xl font-bold md:text-4xl">Start free during beta</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-300">
          Join now — full Pro-equivalent access included while we finish paid checkout. No credit card required.
        </p>
        <Link
          href="/signup/agreements"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-md bg-[#3b82f6] px-8 py-3.5 text-base font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,0.35)] transition hover:bg-[#2563eb]"
        >
          Start Free — No Card Required
        </Link>
        <p className="mt-4 text-sm text-slate-500">Paid plans launch soon.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:px-8" data-testid="landing-signup-section">
      <h2 className="mb-2 text-center text-3xl font-bold md:text-4xl">Simple pricing. Both modes included.</h2>
      <p className="mx-auto mb-8 max-w-2xl text-center text-sm text-slate-400">Choose the plan that matches how you trade.</p>
      <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
        <div aria-label="Free plan" className={pricingCardClass("free")} onClick={(e) => onPricingCardClick(e, "free")}>
          <h3 className="text-xl font-bold">Free</h3>
          <p className="mt-2 text-3xl font-black text-cyan-300">$0/month</p>
          <div className="mt-auto shrink-0 pt-4">
            <Link
              href="/signup/agreements"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2 font-semibold"
            >
              Get Started Free
            </Link>
          </div>
        </div>
        <div aria-label="Swing Pro plan" className={pricingCardClass("swing_pro")} onClick={(e) => onPricingCardClick(e, "swing_pro")}>
          <h3 className="text-xl font-bold">Swing Pro</h3>
          <p className="mt-2 text-3xl font-black text-cyan-300">$49/month</p>
          <div className="mt-auto shrink-0 pt-4">
            <Link
              href="/signup/agreements"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2 font-semibold"
            >
              Choose Swing Pro
            </Link>
          </div>
        </div>
        <div
          aria-label="Swing plus Day Pro plan"
          className={pricingCardClass("swing_day_pro")}
          onClick={(e) => onPricingCardClick(e, "swing_day_pro")}
        >
          <h3 className="text-xl font-bold">Swing + Day Pro</h3>
          <p className="mt-2 text-3xl font-black text-cyan-300">$99/month</p>
          <div className="mt-auto shrink-0 pt-4">
            <Link
              href="/signup/agreements"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#3b82f6] px-4 py-2 font-semibold"
            >
              Choose Swing + Day Pro
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

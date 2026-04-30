import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-16 text-slate-100 md:px-8">
      <div className="mx-auto grid max-w-4xl gap-6">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <h1 className="text-3xl font-bold md:text-4xl">Privacy Policy</h1>
        <section className="rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-slate-300">
            We collect account and usage data needed to operate STOCVEST, including authentication details, profile
            preferences, broker connection metadata, and platform activity.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-300">
            <li>
              Personal data is retained while accounts are active; inactivity cleanup and deletion follow documented
              policy windows.
            </li>
            <li>
              Behavioral trading-performance data may be retained in anonymized form (for platform improvement and
              analytics).
            </li>
            <li>
              Users can request deletion; we delete personal records and anonymize retained behavioral records per
              policy.
            </li>
            <li>Our data handling is designed to support CCPA compliance and clear user deletion workflows.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

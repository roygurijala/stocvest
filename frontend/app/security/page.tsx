import Link from "next/link";

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-[#0a0e1a] px-4 py-14 text-slate-100 md:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-[#3b82f6] hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-5 text-4xl font-black md:text-5xl">Security</h1>
        <p className="mt-4 text-slate-300">
          Security details page coming soon. STOCVEST enforces strict access controls, broker-layer safeguards, and continuous monitoring.
        </p>
      </div>
    </main>
  );
}

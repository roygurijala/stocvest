import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 text-center text-slate-100">
      <section className="grid gap-4">
        <p className="text-7xl font-black tracking-tight text-[#3b82f6] md:text-8xl">404</p>
        <h1 className="text-3xl font-bold">This page doesn&apos;t exist.</h1>
        <p className="text-slate-400">The page you&apos;re looking for has moved or never existed.</p>
        <div>
          <Link
            href="/"
            className="inline-block rounded-md bg-[#3b82f6] px-5 py-2.5 font-semibold text-white shadow-[0_0_22px_rgba(59,130,246,0.4)]"
          >
            Back to Home
          </Link>
        </div>
      </section>
    </main>
  );
}

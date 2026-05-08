import { headers } from "next/headers";

type HealthJson = {
  health?: Record<string, string>;
  checked_at?: string;
  note?: string;
};

async function loadHealth(): Promise<HealthJson | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const secret = process.env.INTERNAL_OPS_TOKEN ?? "";
  if (!secret) {
    return { note: "INTERNAL_OPS_TOKEN unset", health: {}, checked_at: new Date().toISOString() };
  }
  const res = await fetch(`${proto}://${host}/api/dashboard/health`, {
    headers: { "X-Internal-Token": secret },
    cache: "no-store"
  });
  if (!res.ok) return null;
  return (await res.json()) as HealthJson;
}

export default async function OpsHealthPage() {
  const payload = await loadHealth();

  return (
    <div className="min-h-screen bg-slate-950 p-6 font-mono text-sm text-slate-200">
      <h1 className="mb-2 text-lg font-bold text-white">STOCVEST state heat map</h1>
      <p className="mb-6 text-slate-400">{payload?.checked_at ?? new Date().toISOString()}</p>
      {!payload ? (
        <p className="text-red-400">Failed to load health.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="pb-2 pr-4">Field</th>
              <th className="pb-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(payload.health ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <tr key={k} className="border-b border-slate-800">
                  <td className="py-1 pr-4 text-slate-300">{k}</td>
                  <td className="py-1 text-emerald-400/90 break-all">{String(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {payload?.note ? <p className="mt-4 text-amber-400/90">{payload.note}</p> : null}
    </div>
  );
}

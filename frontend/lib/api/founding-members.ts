import { apiBaseUrl } from "@/lib/api/client";

export async function getFoundingMemberCount(): Promise<number | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/v1/signals/founding-members`, {
      method: "GET",
      next: { revalidate: 300 }
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { founding_member_count?: unknown };
    const raw = body.founding_member_count;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  } catch {
    return null;
  }
}

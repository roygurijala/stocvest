export type DashboardTimingSettingsPayload = {
  redisConfigured: boolean;
  envOverride: "on" | "off" | null;
  /** Redis key present: forced on/off. `null` → deployment default (dev on, prod off). */
  redisToggle: boolean | null;
  effectiveEnabled: boolean;
};

export type AdminDashboardLoadTimingsPayload = {
  settings: DashboardTimingSettingsPayload;
  redisConfigured: boolean;
  /** True when Redis env looks set but the read failed (transient or bad credentials). */
  readFailed?: boolean;
  eventCount: number;
  sampleCount: number;
  formattedReport: string;
};

export type AdminDashboardTimingResult =
  | { ok: true; data: AdminDashboardLoadTimingsPayload }
  | { ok: false; status: number; message: string };

export type PostDashboardTimingModeResult =
  | { ok: true; data: DashboardTimingSettingsPayload }
  | { ok: false; status: number; message: string };

export async function fetchAdminDashboardLoadTimings(): Promise<AdminDashboardTimingResult> {
  const res = await fetch("/api/stocvest/admin/dashboard-load-timings", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store"
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string") message = j.error;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    return { ok: false, status: res.status, message };
  }
  const data = (await res.json()) as AdminDashboardLoadTimingsPayload;
  return { ok: true, data };
}

export async function postDashboardTimingMode(
  mode: "on" | "off" | "default"
): Promise<PostDashboardTimingModeResult> {
  const res = await fetch("/api/stocvest/admin/dashboard-timing-settings", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode })
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string") message = j.error;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    return { ok: false, status: res.status, message };
  }
  try {
    const data = JSON.parse(text) as DashboardTimingSettingsPayload;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, message: "Invalid response" };
  }
}

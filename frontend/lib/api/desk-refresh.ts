/**
 * Manual Opportunity Desk refresh — POST /v1/desk/refresh (D13 Phase 4).
 */

export type DeskRefreshResponse = {
  status: string;
  tiers?: string[];
  message?: string;
  retry_after_seconds?: number;
  error?: string;
};

export class DeskRefreshCooldownError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("desk_refresh_cooldown");
    this.name = "DeskRefreshCooldownError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function postDeskRefresh(): Promise<DeskRefreshResponse> {
  const res = await fetch("/api/stocvest/desk/refresh", { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as DeskRefreshResponse & {
    retry_after_seconds?: number;
  };
  if (res.status === 429) {
    throw new DeskRefreshCooldownError(
      typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : 300
    );
  }
  if (!res.ok) {
    throw new Error(body.message || `desk/refresh failed: ${res.status}`);
  }
  return body;
}

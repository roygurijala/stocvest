import { apiFetch } from "@/lib/api/client";
import type { BrokerAccountPayload, BrokerPositionPayload } from "@/lib/api/brokers";

export interface FuturesDashboardOverview {
  connected: boolean;
  statusMessage: string;
  accounts: BrokerAccountPayload[];
  positionsByAccount: Record<string, BrokerPositionPayload[]>;
}

export async function fetchIbkrFuturesOverview(): Promise<FuturesDashboardOverview> {
  try {
    const health = await apiFetch<{ broker: string; ok: boolean; message?: string }>(
      "/v1/brokers/health?broker=ibkr"
    );
    if (!health.ok) {
      return {
        connected: false,
        statusMessage: `IBKR TWS unavailable: ${health.message || "disconnected"}`,
        accounts: [],
        positionsByAccount: {}
      };
    }

    const accounts = await apiFetch<BrokerAccountPayload[]>("/v1/brokers/accounts?broker=ibkr");
    const positionsByAccount: Record<string, BrokerPositionPayload[]> = {};
    await Promise.all(
      accounts.map(async (account) => {
        const qs = new URLSearchParams({
          broker: "ibkr",
          account_id: account.account_id
        }).toString();
        const positions = await apiFetch<BrokerPositionPayload[]>(`/v1/brokers/positions?${qs}`);
        positionsByAccount[account.account_id] = positions;
      })
    );
    return {
      connected: true,
      statusMessage: "IBKR TWS connected",
      accounts,
      positionsByAccount
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unable to reach IBKR TWS gateway.";
    return {
      connected: false,
      statusMessage: `IBKR TWS unavailable: ${message}`,
      accounts: [],
      positionsByAccount: {}
    };
  }
}

import { apiFetch } from "@/lib/api/client";

export type IpoEcosystemPayload = {
  trigger_entity: string;
  registry_key: string;
  sector_name: string;
  listed_ticker: string | null;
  ipo_date: string | null;
  s1_filed_date: string | null;
  target_ipo_window: string | null;
  index_inclusion_window_end: string | null;
  corporate_backers: string[];
  etf_holders: string[];
  theme_peers: string[];
  tradable_peers: string[];
  stake_notes: Record<string, string>;
};

export type IpoEcosystemsResponse = {
  ecosystems?: IpoEcosystemPayload[];
  as_of_note?: string;
  disclaimer?: string;
};

export async function fetchIpoEcosystems(): Promise<IpoEcosystemPayload[]> {
  const res = await apiFetch<IpoEcosystemsResponse>("/api/stocvest/scanner/ipo-ecosystems", {
    cache: "no-store"
  });
  return Array.isArray(res?.ecosystems) ? res.ecosystems : [];
}

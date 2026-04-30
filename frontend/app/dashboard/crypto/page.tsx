import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CryptoPanel } from "@/components/crypto-panel";
import { fetchCryptoOverview } from "@/lib/api/crypto";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardCryptoPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchCryptoOverview("X:BTCUSD");
  return (
    <AppShell session={session}>
      <h1 style={{ marginTop: 0 }}>Crypto</h1>
      <CryptoPanel overview={overview} />
    </AppShell>
  );
}

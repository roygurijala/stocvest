import { NextResponse } from "next/server";
import { fetchVixSnapshotForDashboard } from "@/lib/market/fetch-vix-indices";

/** VIX level for dashboard — uses API Gateway Polygon key, then optional Vercel POLYGON_API_KEY. */
export async function GET() {
  const snap = await fetchVixSnapshotForDashboard();
  return NextResponse.json({ snapshot: snap }, { status: 200 });
}

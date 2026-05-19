import { NextResponse } from "next/server";
import { fetchVixIndicesSnapshot } from "@/lib/market/fetch-vix-indices";

/** Public read of VIX level for dashboard fallback (Polygon key on this host). */
export async function GET() {
  const snap = await fetchVixIndicesSnapshot();
  if (!snap) {
    return NextResponse.json({ snapshot: null }, { status: 200 });
  }
  return NextResponse.json({ snapshot: snap }, { status: 200 });
}

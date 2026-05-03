import { MorningBriefCollapse } from "@/components/morning-brief-collapse";
import { fetchMorningBriefPost, type ScannerCoreData } from "@/lib/api/scanner";
import { isMorningBriefingWindowEt } from "@/lib/market-brief-window";
import type { PDTStatusPayload } from "@/lib/api/pdt";

export async function MorningBriefFromCore({
  core,
  pdtStatus
}: {
  core: ScannerCoreData;
  pdtStatus: PDTStatusPayload | null;
}) {
  if (!isMorningBriefingWindowEt()) {
    return null;
  }
  if (core.error) {
    return null;
  }
  const mb = await fetchMorningBriefPost(pdtStatus, core);
  if (!mb) {
    return null;
  }
  return <MorningBriefCollapse mb={mb} pdt={pdtStatus?.assessment} />;
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import { spacing } from "@/lib/design-system";
import {
  HEAT_RELATIVE_SIZE_MIN,
  heatGroupMedian,
  heatRelativeGridStyle,
  heatRelativeSizeWeights,
  heatRelativeTileLayout
} from "@/lib/dashboard/trading-room/heat-group-present";

type HeatRelativeTileGridProps = {
  pcts: readonly (number | null | undefined)[];
  testId: string;
  gap?: CSSProperties["gap"];
  children: (args: { index: number; weight: number; layout: ReturnType<typeof heatRelativeTileLayout> }) => ReactNode;
};

/** Flex-wrap heat grid where tile area scales with move vs peer median. */
export function HeatRelativeTileGrid({ pcts, testId, gap = spacing[1], children }: HeatRelativeTileGridProps) {
  const median = heatGroupMedian(pcts);
  const weights = heatRelativeSizeWeights(pcts, median);

  const style: CSSProperties = {
    ...heatRelativeGridStyle,
    gap
  };

  return (
    <div data-testid={testId} style={style}>
      {pcts.map((_, index) => {
        const weight = weights[index] ?? HEAT_RELATIVE_SIZE_MIN;
        const layout = heatRelativeTileLayout(weight);
        return children({ index, weight, layout });
      })}
    </div>
  );
}

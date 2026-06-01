import { describe, expect, test } from "vitest";
import { relevanceLabelForTests } from "@/components/news-headline-drawer";

describe("news headline drawer labels", () => {
  test("relevance label mapping", () => {
    expect(relevanceLabelForTests(82)).toBe("high");
    expect(relevanceLabelForTests(55)).toBe("medium");
    expect(relevanceLabelForTests(22)).toBe("low");
  });
});

import { describe, expect, test } from "vitest";

import {
  catalystArticlesForNewsLayer,
  catalystArticlesFromComposite,
  parseLayerCatalystArticles
} from "@/lib/signals/layer-catalyst-articles";

describe("layer-catalyst-articles", () => {
  test("parseLayerCatalystArticles preserves headline metadata", () => {
    const rows = parseLayerCatalystArticles([
      {
        text: "Navan beats earnings expectations",
        source: "benzinga",
        published_at: "2026-06-10T14:00:00Z",
        sentiment: "positive",
        url: "https://example.com/a"
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain("Navan");
    expect(rows[0]?.source).toBe("benzinga");
    expect(rows[0]?.url).toBe("https://example.com/a");
    expect(rows[0]?.sentiment).toBe("positive");
  });

  test("catalystArticlesForNewsLayer prefers layer quality_articles", () => {
    const rows = catalystArticlesForNewsLayer(
      {
        quality_articles: [{ text: "Layer headline", sentiment: "neutral" }]
      },
      { catalyst_headlines: [{ text: "Top-level headline", sentiment: "positive" }] }
    );
    expect(rows[0]?.text).toBe("Layer headline");
  });

  test("catalystArticlesFromComposite prefers catalyst_headlines then merges catalysts", () => {
    const rows = catalystArticlesFromComposite({
      catalyst_headlines: [{ text: "Headline A", sentiment: "positive" }],
      catalysts: [{ text: "Headline B", sentiment: "negative" }]
    });
    expect(rows.map((r) => r.text)).toEqual(["Headline A", "Headline B"]);
  });
});

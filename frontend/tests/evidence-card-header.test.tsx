import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })
  });
});
import { EvidenceCardHeader } from "@/components/signal-evidence/evidence-card-header";
import { ThemeProvider } from "@/lib/theme-provider";

describe("EvidenceCardHeader", () => {
  test("shows bias and alignment instead of direction pill", () => {
    render(
      <ThemeProvider>
        <EvidenceCardHeader
          symbol="TSLA"
          tradingMode="swing"
          bias="Bearish"
          rows={[
            { key: "technical", name: "Technical", status: "Bearish", explanation: "", score: 80 },
            { key: "news", name: "News", status: "Neutral", explanation: "", score: 50 },
            { key: "macro", name: "Macro", status: "Neutral", explanation: "", score: 50 },
            { key: "sector", name: "Sector", status: "Neutral", explanation: "", score: 50 },
            { key: "internals", name: "Internals", status: "Neutral", explanation: "", score: 50 },
            { key: "geopolitical", name: "Geopolitical", status: "Neutral", explanation: "", score: 50 }
          ]}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("evidence-card-bias")).toHaveTextContent("Bearish");
    expect(screen.getByTestId("evidence-card-alignment-context")).toHaveTextContent(/Not aligned/i);
    expect(screen.getByTestId("evidence-card-alignment-links-evolution")).toBeInTheDocument();
    expect(screen.queryByText(/^short$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT INVESTMENT ADVICE/i)).not.toBeInTheDocument();
  });
});

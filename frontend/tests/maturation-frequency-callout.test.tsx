import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import { MaturationFrequencyCallout } from "@/components/maturation-frequency-callout";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  });
});

describe("MaturationFrequencyCallout", () => {
  test("renders cadence bullets and optional display bands", () => {
    render(
      <ThemeProvider>
        <MaturationFrequencyCallout desk="swing" showDisplayBands />
      </ThemeProvider>
    );
    expect(screen.getByTestId("maturation-frequency-callout")).toHaveTextContent(/4:30 PM ET/i);
    expect(screen.getByTestId("maturation-frequency-callout")).toHaveTextContent(/Near ready/i);
    expect(screen.getByTestId("maturation-frequency-callout")).toHaveTextContent(/Actionable \(5–6\)/i);
  });
});

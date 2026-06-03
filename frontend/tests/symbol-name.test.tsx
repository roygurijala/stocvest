import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { SymbolName } from "@/components/symbol-name";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("SymbolName", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocvest/market/symbol-names")) {
          const u = new URL(url, "http://localhost");
          const symbols = (u.searchParams.get("symbols") ?? "").split(",");
          const names: Record<string, string> = {};
          if (symbols.includes("ZNAMEA")) names.ZNAMEA = "Zname Alpha Inc.";
          return new Response(JSON.stringify({ names }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }) as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the bare ticker immediately", () => {
    wrap(<SymbolName symbol="ZNAMEB" resolve={false} />);
    expect(screen.getByText("ZNAMEB")).toBeTruthy();
  });

  test("shows a passed-in company name without fetching", () => {
    wrap(<SymbolName symbol="ZNAMEC" name="Passed Co" resolve={false} />);
    expect(screen.getByText("ZNAMEC")).toBeTruthy();
    expect(screen.getByText("Passed Co")).toBeTruthy();
  });

  test("resolves and displays a company name from the endpoint", async () => {
    wrap(<SymbolName symbol="znamea" />);
    expect(screen.getByText("ZNAMEA")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Zname Alpha Inc.")).toBeTruthy());
  });

  test("truncates long company names", () => {
    wrap(<SymbolName symbol="ZNAMED" name="A Very Long Company Name That Exceeds The Limit" resolve={false} maxNameChars={10} />);
    const node = screen.getByText(/A Very Lo/);
    expect(node.textContent?.endsWith("…")).toBe(true);
  });
});

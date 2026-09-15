import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DeepDiveReturnLink } from "@/components/dashboard/trading-room/deep-dive-return-link";

const searchParamsGet = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useSearchParams: () => ({ get: searchParamsGet })
}));

afterEach(() => {
  cleanup();
  searchParamsGet.mockReset();
});

const colors = { textMuted: "#888" };

describe("<DeepDiveReturnLink />", () => {
  test("renders Session brief when there is no origin ref", () => {
    searchParamsGet.mockReturnValue(null);
    render(<DeepDiveReturnLink colors={colors} onBackToBrief={() => undefined} />);
    const link = screen.getByTestId("deep-dive-return-link");
    expect(link.textContent).toContain("Session brief");
    expect(link.getAttribute("href")).toBeNull();
  });

  test("renders Invest when ref is invest", () => {
    searchParamsGet.mockReturnValue("invest");
    render(<DeepDiveReturnLink colors={colors} onBackToBrief={() => undefined} />);
    const link = screen.getByTestId("deep-dive-return-link");
    expect(link.textContent).toContain("Invest");
    expect(link.getAttribute("href")).toBe("/dashboard/invest");
  });

  test("renders My Portfolio when ref is portfolio", () => {
    searchParamsGet.mockReturnValue("portfolio");
    render(<DeepDiveReturnLink colors={colors} onBackToBrief={() => undefined} />);
    const link = screen.getByTestId("deep-dive-return-link");
    expect(link.textContent).toContain("My Portfolio");
    expect(link.getAttribute("href")).toBe("/dashboard/my-portfolio");
  });
});

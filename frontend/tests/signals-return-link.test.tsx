import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SignalsReturnLink } from "@/components/signals/signals-return-link";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() })
}));

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      textMuted: "#888"
    }
  })
}));

afterEach(() => cleanup());

describe("<SignalsReturnLink />", () => {
  test("renders contextual back link for dashboard ref", () => {
    render(<SignalsReturnLink navigationRef="dashboard" />);
    const link = screen.getByTestId("signals-return-link");
    expect(link.textContent).toContain("Back to Dashboard");
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  test("renders nothing without ref", () => {
    render(<SignalsReturnLink navigationRef={null} />);
    expect(screen.queryByTestId("signals-return-link")).toBeNull();
  });
});

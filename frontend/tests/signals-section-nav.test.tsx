import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SignalsSectionNav } from "@/components/signals/signals-section-nav";

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      surface: "#111",
      surfaceMuted: "#1a1a1a",
      border: "#333",
      text: "#eee",
      textMuted: "#999",
      accent: "#3b82f6"
    },
    theme: "dark"
  })
}));

describe("SignalsSectionNav", () => {
  test("renders pills and scrolls to target on click", () => {
    const target = document.createElement("div");
    target.id = "signals-layers";
    document.body.appendChild(target);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    render(
      <SignalsSectionNav
        sections={[
          { id: "setup", label: "Setup", targetId: "signals-section-setup" },
          { id: "layers", label: "Layers", targetId: "signals-layers" }
        ]}
      />
    );

    fireEvent.click(screen.getByTestId("signals-section-nav-layers"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    target.remove();
  });
});

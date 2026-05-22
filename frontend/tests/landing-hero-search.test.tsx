import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LandingHeroSearch } from "@/components/landing/landing-hero-search";
import { ThemeProvider } from "@/lib/theme-provider";

describe("LandingHeroSearch", () => {
  test("shows motto and search", () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    expect(screen.getByText(/Judgment\. Restraint\. Gating\. Permission\./i)).toBeInTheDocument();
    expect(screen.getByTestId("landing-stock-search")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /when to stay out/i })).toBeInTheDocument();
  });

  test("NFLX quick pick shows preview card", async () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "NFLX" }));
    await waitFor(() => {
      expect(screen.getByTestId("landing-stock-preview")).toBeInTheDocument();
    });
    const card = screen.getByTestId("landing-stock-preview");
    expect(card).toHaveTextContent(/Not actionable/i);
    expect(card).toHaveTextContent(/NFLX — current read/i);
  });
});

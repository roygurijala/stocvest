import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LandingHeroSearch } from "@/components/landing/landing-hero-search";
import { ThemeProvider } from "@/lib/theme-provider";

describe("LandingHeroSearch", () => {
  test("shows search placeholder and full examples label", () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    expect(screen.getByPlaceholderText(/Type any stock to preview the system/i)).toBeInTheDocument();
    expect(screen.getByText(/Try examples:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Stop wasting trades/i)).toBeNull();
    expect(screen.getAllByText(/Judgment\. Restraint\. Gating\. Permission\./i)).toHaveLength(1);
    expect(screen.getByRole("heading", { name: /when to stay out/i })).toBeInTheDocument();
    expect(screen.queryByTestId("stocvest-logo")).toBeNull();
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
    expect(card).toHaveTextContent(/Sample system read — live data unlocks after signup/i);
    expect(card).toHaveTextContent(/exactly how the system filters trades/i);
  });

  test("editing search away from symbol closes preview", async () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "NFLX" }));
    await waitFor(() => expect(screen.getByTestId("landing-stock-preview")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("landing-stock-search"), { target: { value: "NFL" } });
    expect(screen.queryByTestId("landing-stock-preview")).toBeNull();
    expect(screen.getByTestId("landing-stock-search")).toHaveValue("NFL");
  });

  test("clearing search closes preview", async () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "NFLX" }));
    await waitFor(() => expect(screen.getByTestId("landing-stock-preview")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("landing-stock-search"), { target: { value: "" } });
    expect(screen.queryByTestId("landing-stock-preview")).toBeNull();
  });

  test("close button dismisses preview", async () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "AAPL" }));
    await waitFor(() => expect(screen.getByTestId("landing-stock-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("landing-stock-preview-close"));
    expect(screen.queryByTestId("landing-stock-preview")).toBeNull();
    expect(screen.getByTestId("landing-stock-search")).toHaveValue("");
  });

  test("AMD shows limited preview", async () => {
    render(
      <ThemeProvider>
        <LandingHeroSearch />
      </ThemeProvider>
    );
    fireEvent.change(screen.getByTestId("landing-stock-search"), { target: { value: "AMD" } });
    fireEvent.keyDown(screen.getByTestId("landing-stock-search"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("landing-limited-preview")).toBeInTheDocument());
    expect(screen.getByText(/This is a limited preview/i)).toBeInTheDocument();
  });
});

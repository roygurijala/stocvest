import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { AppOverlayScrim } from "@/components/app-overlay-scrim";
import { resetBodyScrollLock } from "@/lib/body-scroll-lock";

afterEach(() => {
  resetBodyScrollLock();
});

describe("AppOverlayScrim", () => {
  test("assistant-mobile locks background scroll", () => {
    render(<AppOverlayScrim open variant="assistant-mobile" onClose={() => undefined} lockScroll testId="assistant-overlay-scrim" />);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("assistant-overlay-scrim")).toHaveClass("app-overlay-scrim--assistant-mobile");
  });

  test("assistant-desktop does not lock scroll", () => {
    render(<AppOverlayScrim open variant="assistant-desktop" lockScroll={false} testId="assistant-overlay-scrim" />);
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByTestId("assistant-overlay-scrim")).toHaveClass("app-overlay-scrim--assistant-desktop");
  });

  test("modal variant uses blurred backdrop class", () => {
    render(<AppOverlayScrim open variant="modal" onClose={() => undefined} testId="modal-scrim" />);
    expect(screen.getByTestId("modal-scrim")).toHaveClass("app-overlay-scrim--modal");
  });
});

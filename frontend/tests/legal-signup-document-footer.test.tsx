import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LegalSignupDocumentFooter } from "@/components/auth/legal-signup-document-footer";
import { LEGAL_DOCUMENT_READ_MESSAGE } from "@/lib/legal-agreements";

function mockScrollMetrics({ scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(document.body, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrollTop });
}

describe("LegalSignupDocumentFooter", () => {
  beforeEach(() => {
    mockScrollMetrics({ scrollHeight: 2000, clientHeight: 800, scrollTop: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("Agree button disabled until scrolled to bottom", () => {
    render(<LegalSignupDocumentFooter href="/terms" label="Terms of Service" />);
    const agree = screen.getByRole("button", { name: /I Agree to the Terms of Service/i });
    expect(agree).toBeDisabled();
    expect(screen.getByText(/Scroll to the bottom/i)).toBeInTheDocument();

    mockScrollMetrics({ scrollHeight: 2000, clientHeight: 800, scrollTop: 1200 });
    fireEvent.scroll(window);
    expect(agree).not.toBeDisabled();
  });

  test("short document enables Agree immediately", () => {
    mockScrollMetrics({ scrollHeight: 600, clientHeight: 900, scrollTop: 0 });
    render(<LegalSignupDocumentFooter href="/privacy" label="Privacy Policy" />);
    expect(screen.getByRole("button", { name: /I Agree to the Privacy Policy/i })).not.toBeDisabled();
  });

  test("clicking Agree posts message to parent", () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
    mockScrollMetrics({ scrollHeight: 900, clientHeight: 900, scrollTop: 0 });

    render(<LegalSignupDocumentFooter href="/terms" label="Terms of Service" />);
    const agree = screen.getByRole("button", { name: /I Agree to the Terms of Service/i });
    fireEvent.click(agree);

    expect(postMessage).toHaveBeenCalledWith({ type: LEGAL_DOCUMENT_READ_MESSAGE, href: "/terms" }, window.location.origin);
    expect(screen.getByText(/Agreed — returning to registration/i)).toBeInTheDocument();
  });
});

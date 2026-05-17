import { afterEach, describe, expect, test } from "vitest";

import { lockBodyScroll, resetBodyScrollLock } from "@/lib/body-scroll-lock";

afterEach(() => {
  resetBodyScrollLock();
});

describe("body-scroll-lock", () => {
  test("nested locks release only when all unlock", () => {
    const unlockA = lockBodyScroll();
    expect(document.body.style.overflow).toBe("hidden");
    const unlockB = lockBodyScroll();
    unlockA();
    expect(document.body.style.overflow).toBe("hidden");
    unlockB();
    expect(document.body.style.overflow).toBe("");
  });

  test("resetBodyScrollLock clears stuck state", () => {
    lockBodyScroll();
    resetBodyScrollLock();
    expect(document.body.style.overflow).toBe("");
  });
});

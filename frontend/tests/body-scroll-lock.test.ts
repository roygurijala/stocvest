import { afterEach, describe, expect, test } from "vitest";

import {
  APP_SCROLL_ROOT_SELECTOR,
  lockBodyScroll,
  resetBodyScrollLock
} from "@/lib/body-scroll-lock";

afterEach(() => {
  resetBodyScrollLock();
  document.querySelector(APP_SCROLL_ROOT_SELECTOR)?.remove();
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

  test("locks dashboard main scroll root when present", () => {
    const main = document.createElement("main");
    main.setAttribute("data-app-scroll-root", "");
    document.body.appendChild(main);

    const unlock = lockBodyScroll();
    expect(main.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    unlock();
    expect(main.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
  });

  test("resetBodyScrollLock clears stuck state", () => {
    lockBodyScroll();
    resetBodyScrollLock();
    expect(document.body.style.overflow).toBe("");
  });
});

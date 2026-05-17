"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { resetBodyScrollLock } from "@/lib/body-scroll-lock";

/** Clears stuck scroll locks after navigations and back-forward cache restores. */
export function BodyScrollResetOnNavigate() {
  const pathname = usePathname();

  useEffect(() => {
    resetBodyScrollLock();
  }, [pathname]);

  useEffect(() => {
    const onPageShow = () => resetBodyScrollLock();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return null;
}

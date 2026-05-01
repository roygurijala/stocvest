"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const WEBSITE_ID = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID?.trim();

/** Crisp only supports named color themes; `blue` is closest to brand #3b82f6. */
const CRISP_THEME = "blue" as const;

const WELCOME_TEXT =
  "Hi! We are building STOCVEST for serious traders. Your feedback shapes the product. What is on your mind?";

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

let crispScriptInjected = false;
let welcomeHandlerRegistered = false;
let welcomeShown = false;

function crispPush(cmd: unknown[]): void {
  if (typeof window === "undefined" || !window.$crisp) return;
  window.$crisp.push(cmd);
}

/** Opens the Crisp chatbox (e.g. from sidebar). No-op if Crisp is not configured. Queues on `$crisp` before the script finishes loading. */
export function openCrispChat(): void {
  if (!WEBSITE_ID || typeof window === "undefined") return;
  window.$crisp = window.$crisp || [];
  if (!window.CRISP_WEBSITE_ID) window.CRISP_WEBSITE_ID = WEBSITE_ID;
  window.$crisp.push(["do", "chat:open"]);
}

interface CrispChatProps {
  userEmail: string | null;
}

export function CrispChat({ userEmail }: CrispChatProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (!WEBSITE_ID || crispScriptInjected) return;
    crispScriptInjected = true;

    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = WEBSITE_ID;

    crispPush(["config", "color:theme", [CRISP_THEME]]);
    crispPush(["config", "color:mode", ["dark"]]);
    crispPush(["config", "position:reverse", [false]]);

    if (!welcomeHandlerRegistered) {
      welcomeHandlerRegistered = true;
      crispPush([
        "on",
        "session:loaded",
        () => {
          if (welcomeShown) return;
          welcomeShown = true;
          crispPush(["do", "message:show", ["text", WELCOME_TEXT]]);
        }
      ]);
    }

    const s = document.createElement("script");
    s.src = "https://client.crisp.chat/l.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!WEBSITE_ID || !userEmail) return;
    crispPush(["set", "user:email", [userEmail]]);
    crispPush(["set", "user:nickname", [userEmail]]);
    crispPush(["set", "session:data", [[["page", pathname], ["plan", "beta"]]]]);
  }, [userEmail, pathname]);

  if (!WEBSITE_ID) {
    return null;
  }

  return null;
}

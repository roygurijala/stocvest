"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { UserMePayload } from "@/lib/api/contracts";
import { LegalAcknowledgmentModal } from "@/components/legal-acknowledgment-modal";
import { OnboardingWizardModal } from "@/components/onboarding-wizard-modal";

interface DashboardComplianceClientProps {
  hasSession: boolean;
  children: ReactNode;
}

export function DashboardComplianceClient({ hasSession, children }: DashboardComplianceClientProps) {
  const [profile, setProfile] = useState<UserMePayload | null>(null);
  const [loaded, setLoaded] = useState(!hasSession);
  const [skipOnboardingSession, setSkipOnboardingSession] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasSession) {
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch("/api/stocvest/users/me", { cache: "no-store" });
      if (!res.ok) {
        setProfile(null);
        return;
      }
      const data = (await res.json()) as UserMePayload;
      setProfile(data);
    } catch {
      setProfile(null);
    } finally {
      setLoaded(true);
    }
  }, [hasSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showLegal = hasSession && loaded && profile && !profile.legal_acknowledged;
  const showOnboarding =
    hasSession &&
    loaded &&
    profile &&
    profile.legal_acknowledged &&
    !profile.onboarding_completed &&
    !skipOnboardingSession;

  return (
    <div style={{ position: "relative", minHeight: "100%" }}>
      <div
        style={{
          pointerEvents: showLegal ? "none" : "auto",
          userSelect: showLegal ? "none" : "auto",
          opacity: showLegal ? 0.25 : 1,
          transition: "opacity 0.2s ease"
        }}
        aria-hidden={showLegal ? true : undefined}
      >
        {children}
      </div>
      {showLegal ? (
        <LegalAcknowledgmentModal
          onCompleted={() => {
            void refresh();
          }}
        />
      ) : null}
      {showOnboarding ? (
        <OnboardingWizardModal
          onCompleted={() => void refresh()}
          onRemindLater={() => setSkipOnboardingSession(true)}
        />
      ) : null}
    </div>
  );
}

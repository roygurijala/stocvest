"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { UserMePayload } from "@/lib/api/contracts";
import { LegalAcknowledgmentModal } from "@/components/legal-acknowledgment-modal";
import { OnboardingWizardModal } from "@/components/onboarding-wizard-modal";
import { TrialUpgradeWall } from "@/components/trial/trial-upgrade-wall";
import { UserProfileProvider } from "@/lib/user-profile-context";
import { needsPhoneVerification, trialExpired } from "@/lib/trial-access";
import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

interface DashboardComplianceClientProps {
  hasSession: boolean;
  children: ReactNode;
}

export function DashboardComplianceClient({ hasSession, children }: DashboardComplianceClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserMePayload | null>(null);
  const [loaded, setLoaded] = useState(!hasSession);
  const [skipOnboardingSession, setSkipOnboardingSession] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasSession) {
      setLoaded(true);
      return;
    }
    try {
      let res = await fetch("/api/stocvest/users/me", { cache: "no-store" });
      if (res.status === 401) {
        // Surface auth failures instead of silently limping with a dead token.
        // This refreshes the session when possible, or marks it expired so the
        // user gets a clean "Sign in" path rather than a stuck dashboard.
        const handled = await surfaceAuthErrorIfAny(res);
        if (handled) {
          res = await fetch("/api/stocvest/users/me", { cache: "no-store" });
        }
      }
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

  const phoneRequired = hasSession && loaded && needsPhoneVerification(profile);
  const trialEnded = hasSession && loaded && trialExpired(profile);
  const onPhoneOnboarding = pathname === "/onboarding/phone";

  useEffect(() => {
    if (phoneRequired && !onPhoneOnboarding && !showLegal && !showOnboarding) {
      router.replace("/onboarding/phone");
    }
  }, [phoneRequired, onPhoneOnboarding, showLegal, showOnboarding, router]);

  const blockForTrial = trialEnded && !onPhoneOnboarding;
  const profileCtx = { profile, loaded: hasSession ? loaded : true };

  return (
    <UserProfileProvider value={profileCtx}>
      <div style={{ position: "relative", minHeight: "100%" }}>
        <div
          style={{
            pointerEvents: showLegal || blockForTrial ? "none" : "auto",
            userSelect: showLegal || blockForTrial ? "none" : "auto",
            opacity: showLegal || blockForTrial ? 0.25 : 1,
            transition: "opacity 0.2s ease"
          }}
          aria-hidden={showLegal || blockForTrial ? true : undefined}
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
      {blockForTrial ? <TrialUpgradeWall /> : null}
      </div>
    </UserProfileProvider>
  );
}

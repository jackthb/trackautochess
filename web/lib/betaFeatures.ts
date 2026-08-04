"use client";

import { useSessionFlags, type FlagAccess } from "@/lib/sessionFlags";

export type BetaFeatureAccess = FlagAccess;

export function useChatbotAccess(_steamId?: string | null): BetaFeatureAccess {
  const { admin } = useSessionFlags();
  return admin;
}

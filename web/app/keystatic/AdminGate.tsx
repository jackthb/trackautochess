"use client";

import dynamic from "next/dynamic";
import { BetaFeaturesGate } from "@/components/app/BetaFeaturesGate";

const KeystaticApp = dynamic(() => import("./keystatic"), { ssr: false });

export default function KeystaticAdminGate() {
  return (
    <BetaFeaturesGate title="CMS" allowDevBypass bare>
      <KeystaticApp />
    </BetaFeaturesGate>
  );
}

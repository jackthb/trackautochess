"use client";

import dynamic from "next/dynamic";
import { AdminGate } from "@/components/app/AdminGate";

const KeystaticApp = dynamic(() => import("./keystatic"), { ssr: false });

export default function KeystaticAdminGate() {
  return (
    <AdminGate allowDevBypass bare>
      <KeystaticApp />
    </AdminGate>
  );
}

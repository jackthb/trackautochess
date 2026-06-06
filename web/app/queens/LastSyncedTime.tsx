"use client";

import { useEffect, useState } from "react";

interface LastSyncedTimeProps {
  value: string | null;
}

function formatSyncedTime(value: string | null, timeZone?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

export function LastSyncedTime({ value }: LastSyncedTimeProps) {
  const [label, setLabel] = useState(() => formatSyncedTime(value, "UTC"));

  useEffect(() => {
    setLabel(formatSyncedTime(value));
  }, [value]);

  return <strong title={value ?? undefined}>{label}</strong>;
}

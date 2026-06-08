import type { TrackerStatus } from "../types";

interface StatusBarProps {
  status: TrackerStatus | null;
}

export function StatusBar({ status }: StatusBarProps) {
  void status;
  return null;
}

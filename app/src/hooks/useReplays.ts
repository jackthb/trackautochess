import { useState, useCallback, useEffect } from "react";
import type { Replay, ReplayStats } from "../types";

interface ReplaysState {
  replays: Replay[];
  stats: ReplayStats;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useReplays(): ReplaysState {
  const [replays, setReplays] = useState<Replay[]>([]);
  const [stats, setStats] = useState<ReplayStats>({ count: 0, totalBytes: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, st] = await Promise.all([
      window.replays.list(),
      window.replays.stats(),
    ]);
    setReplays(list);
    setStats(st);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, []);

  return { replays, stats, loading, refresh };
}

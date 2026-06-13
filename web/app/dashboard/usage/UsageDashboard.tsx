"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import styles from "./usage.module.css";

interface TableVolume {
  table: string;
  rows: number;
  last_24h: number | null;
}

interface UsagePayload {
  generated_at: string;
  volume: {
    total_rows: number;
    tables: TableVolume[];
  };
  supabase: {
    users: {
      total: number;
      drodo_fetched: number;
      drodo_never_fetched: number;
      drodo_missing: number;
    };
    queens: {
      candidates: number;
      displayed: number;
      newest_ladder_seen_at: string | null;
      oldest_displayed_profile_fetched_at: string | null;
    };
    drodo_refresh: {
      profiles_last_fetched_1h: number;
      profiles_last_fetched_24h: number;
      profiles_last_fetched_7d: number;
      snapshots_written_24h: number;
      active_due_now: number;
      active_never_fetched: number;
      all_due_now: number;
      due_next_hour: number;
      overdue_more_than_1h: number;
    };
  };
  vercel: {
    billing_usage_available: boolean;
    note: string;
    guardrails: Record<string, number | null>;
  };
  polling: {
    batch_size_active: number;
    batch_size_all: number;
  };
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString();
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function pct(part: number, total: number): string {
  if (total <= 0) return "-";
  return `${Math.round((part / total) * 100)}%`;
}

export function UsageDashboard() {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        if (!cancelled) {
          setError("Sign in as an admin to view usage.");
          setLoading(false);
        }
        return;
      }

      const response = await fetch("/api/admin/usage", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load usage.");
      } else {
        setData(payload);
      }
      setLoading(false);
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load usage.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const guardrails = useMemo(
    () =>
      data
        ? Object.entries(data.vercel.guardrails).map(([key, value]) => ({
            key: key.replace(/_/g, " "),
            value,
          }))
        : [],
    [data]
  );

  if (loading) return <div className={styles.panel}>Loading usage</div>;
  if (error) return <div className={styles.panel}>Usage unavailable: {error}</div>;
  if (!data) return null;

  const refresh = data.supabase.drodo_refresh;
  const users = data.supabase.users;
  const queens = data.supabase.queens;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1>Usage</h1>
          <p>Operational volume and refresh pressure from the existing database.</p>
        </div>
        <span>{formatDate(data.generated_at)}</span>
      </header>

      <section className={styles.metrics}>
        <div className={styles.metric}>
          <span>Total tracked rows</span>
          <strong>{formatNumber(data.volume.total_rows)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Profiles fetched in 24h</span>
          <strong>{formatNumber(refresh.profiles_last_fetched_24h)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Active due now</span>
          <strong>{formatNumber(refresh.active_due_now)}</strong>
        </div>
        <div className={styles.metric}>
          <span>Queen rows shown</span>
          <strong>{formatNumber(queens.displayed)}</strong>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={styles.panel}>
          <h2>Supabase Volume</h2>
          <div className={styles.table}>
            <div className={styles.row}>
              <span>Table</span>
              <span>Rows</span>
              <span>24h</span>
            </div>
            {data.volume.tables.map((entry) => (
              <div className={styles.row} key={entry.table}>
                <span>{entry.table}</span>
                <span>{formatNumber(entry.rows)}</span>
                <span>{formatNumber(entry.last_24h)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <h2>Drodo Refresh</h2>
          <dl className={styles.list}>
            <div>
              <dt>Profiles fetched in 1h</dt>
              <dd>{formatNumber(refresh.profiles_last_fetched_1h)}</dd>
            </div>
            <div>
              <dt>Profiles fetched in 7d</dt>
              <dd>{formatNumber(refresh.profiles_last_fetched_7d)}</dd>
            </div>
            <div>
              <dt>Snapshots written in 24h</dt>
              <dd>{formatNumber(refresh.snapshots_written_24h)}</dd>
            </div>
            <div>
              <dt>Never-fetched active profiles</dt>
              <dd>{formatNumber(refresh.active_never_fetched)}</dd>
            </div>
            <div>
              <dt>All due now</dt>
              <dd>{formatNumber(refresh.all_due_now)}</dd>
            </div>
            <div>
              <dt>Overdue more than 1h</dt>
              <dd>{formatNumber(refresh.overdue_more_than_1h)}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.panel}>
          <h2>Tracked Users</h2>
          <dl className={styles.list}>
            <div>
              <dt>Total users</dt>
              <dd>{formatNumber(users.total)}</dd>
            </div>
            <div>
              <dt>Fetched profiles</dt>
              <dd>
                {formatNumber(users.drodo_fetched)} <small>{pct(users.drodo_fetched, users.total)}</small>
              </dd>
            </div>
            <div>
              <dt>Never fetched</dt>
              <dd>{formatNumber(users.drodo_never_fetched)}</dd>
            </div>
            <div>
              <dt>Missing on Drodo</dt>
              <dd>{formatNumber(users.drodo_missing)}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.panel}>
          <h2>Queen Refresh</h2>
          <dl className={styles.list}>
            <div>
              <dt>Candidate rows</dt>
              <dd>{formatNumber(queens.candidates)}</dd>
            </div>
            <div>
              <dt>Newest ladder pull</dt>
              <dd>{formatDate(queens.newest_ladder_seen_at)}</dd>
            </div>
            <div>
              <dt>Oldest visible Drodo profile</dt>
              <dd>{formatDate(queens.oldest_displayed_profile_fetched_at)}</dd>
            </div>
            <div>
              <dt>Due next hour</dt>
              <dd>{formatNumber(refresh.due_next_hour)}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.panel}>
          <h2>Vercel Guardrails</h2>
          <p className={styles.note}>{data.vercel.note}</p>
          <dl className={styles.list}>
            {guardrails.map((entry) => (
              <div key={entry.key}>
                <dt>{entry.key}</dt>
                <dd>{formatNumber(entry.value)}</dd>
              </div>
            ))}
            <div>
              <dt>Active poll batch</dt>
              <dd>{formatNumber(data.polling.batch_size_active)}</dd>
            </div>
            <div>
              <dt>All poll batch</dt>
              <dd>{formatNumber(data.polling.batch_size_all)}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SeoHead } from "@/lib/seo";
import { SITE_TITLE } from "@/lib/site";
import { playerProfilePath } from "@/lib/steam";

interface DashboardProps {
  supabase: SupabaseClient | null;
}

export default function Dashboard({ supabase }: DashboardProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
      if (!user) {
        router.replace("/");
      } else {
        const steamId = user.user_metadata?.steam_id;
        const customUrl = user.user_metadata?.custom_url;
        if (steamId) {
          router.replace(playerProfilePath(steamId, customUrl));
        } else {
          router.replace("/");
        }
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) router.replace("/");
    });
    return () => subscription.unsubscribe();
  }, [supabase, router]);

  void user;

  return (
    <>
      <SeoHead
        title={`Dashboard | ${SITE_TITLE}`}
        description="Track Auto Chess dashboard."
        path="/dashboard"
        noindex
      />
      <style jsx>{`
        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: calc(100vh - var(--nav-height));
          color: var(--text-muted);
          font-size: 15px;
          letter-spacing: 1px;
        }
        .loading::after {
          content: '';
          width: 14px;
          height: 14px;
          border: 1.5px solid var(--text-muted);
          border-top-color: transparent;
          border-radius: 50%;
          margin-left: 10px;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="loading">{loading ? "Loading" : "Redirecting"}</div>
    </>
  );
}

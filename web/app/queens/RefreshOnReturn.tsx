"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The server rebuilds /queens the moment a Queen's stats change, but a tab
// restored from the back/forward cache or a client-side navigation served from
// the router cache keeps showing the payload it last rendered. Re-fetch the
// page whenever the user comes back to it so the table matches the current
// ladder. router.refresh() pulls the latest ISR payload, so it stays cheap.
export function RefreshOnReturn() {
  const router = useRouter();

  useEffect(() => {
    // Covers client-side navigation back to /queens within the router cache's
    // stale window.
    router.refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}

import { cookies } from "next/headers";

// App Router version of partitionDraftCookie. After draftMode().enable()/disable()
// sets Next's __prerender_bypass cookie, re-stamp it as
// SameSite=None; Secure; Partitioned (production only) so it's delivered inside
// the cross-site Sanity Presentation iframe. cookies().set() with the same name
// overrides the attributes draftMode() applied. See the Pages-Router original in
// lib/sanity/draftCookie.ts (now removed).
export async function partitionDraftCookie(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const store = await cookies();
  const current = store.get("__prerender_bypass");
  if (!current) return;
  store.set({
    name: "__prerender_bypass",
    value: current.value,
    httpOnly: true,
    sameSite: "none",
    secure: true,
    partitioned: true,
    path: "/",
  });
}

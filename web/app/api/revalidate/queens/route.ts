import { revalidatePath } from "next/cache";

// Pinged by the desktop backend after a Queen ladder upload (and its new-player
// profile backfill) has been committed, so /queens rebuilds with the fresh data
// instead of waiting out the ISR window. Unauthenticated by design: desktop
// clients cannot hold a secret, and the worst case is an extra page render.
function handle() {
  revalidatePath("/queens");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}

export async function POST() {
  return handle();
}

export async function GET() {
  return handle();
}

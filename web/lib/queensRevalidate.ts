import { revalidatePath } from "next/cache";
import { playerProfilePath } from "@/lib/steam";

export interface QueenRevalidationTarget {
  steam_id: string;
  custom_url?: string | null;
}

// Rebuilds the ISR'd /queens table immediately instead of waiting out its
// revalidate window. revalidatePath needs a request scope, so only import
// this from route handlers — never from client components, page renders, or
// the standalone poll script (which pings /api/revalidate/queens instead).
export function revalidateQueensPage() {
  revalidatePath("/queens");
}

export function revalidatePlayerProfilePage(target: QueenRevalidationTarget) {
  revalidatePath(playerProfilePath(target.steam_id));
  if (target.custom_url) {
    revalidatePath(playerProfilePath(target.steam_id, target.custom_url));
  }
}

export function revalidateQueenPages(target?: QueenRevalidationTarget) {
  revalidateQueensPage();
  if (target) {
    revalidatePlayerProfilePage(target);
  }
}

import { revalidatePath } from "next/cache";

// Rebuilds the ISR'd /queens table immediately instead of waiting out its
// revalidate window. revalidatePath needs a request scope, so only import
// this from route handlers — never from client components, page renders, or
// the standalone poll script (which pings /api/revalidate/queens instead).
export function revalidateQueensPage() {
  revalidatePath("/queens");
}

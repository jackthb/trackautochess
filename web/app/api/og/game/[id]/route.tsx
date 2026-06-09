import { NextResponse } from "next/server";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.redirect(new URL(`/api/og/match/${id}`, req.url), 308);
}

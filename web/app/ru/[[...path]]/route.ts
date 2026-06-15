import { NextResponse } from "next/server";

const headers = { "X-Robots-Tag": "noindex" };

export function GET() {
  return new NextResponse("Gone", { status: 410, headers });
}

export function HEAD() {
  return new NextResponse(null, { status: 410, headers });
}

import { NextRequest, NextResponse } from "next/server";
import { QUEENS_VISITOR_COOKIE, QUEENS_VISITOR_HEADER } from "@/lib/queensVisitor";

const VISITOR_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function proxy(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  const existingVisitorId = req.cookies.get(QUEENS_VISITOR_COOKIE)?.value;
  const visitorId = existingVisitorId || crypto.randomUUID();
  requestHeaders.set(QUEENS_VISITOR_HEADER, visitorId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (!existingVisitorId) {
    res.cookies.set(QUEENS_VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      maxAge: VISITOR_MAX_AGE_SECONDS,
      path: "/queens",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return res;
}

export const config = {
  matcher: "/queens",
};

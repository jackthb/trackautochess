import { makeRouteHandler } from "@keystatic/next/route-handler";

type KeystaticHandler = ReturnType<typeof makeRouteHandler>;

let handler: KeystaticHandler | null = null;

function missingGithubEnv(): string[] {
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.NEXT_PUBLIC_KEYSTATIC_GITHUB_APP_SLUG
  ) {
    return [];
  }

  const requiredEnv: Array<[string, string | undefined]> = [
    ["KEYSTATIC_GITHUB_CLIENT_ID", process.env.KEYSTATIC_GITHUB_CLIENT_ID],
    ["KEYSTATIC_GITHUB_CLIENT_SECRET", process.env.KEYSTATIC_GITHUB_CLIENT_SECRET],
    ["KEYSTATIC_SECRET", process.env.KEYSTATIC_SECRET],
  ];

  return requiredEnv.filter(([, value]) => !value).map(([name]) => name);
}

async function getHandler(): Promise<KeystaticHandler | Response> {
  const missing = missingGithubEnv();
  if (missing.length > 0) {
    return Response.json(
      { error: "Keystatic GitHub storage is not configured", missing },
      { status: 503 },
    );
  }

  if (!handler) {
    const { default: config } = await import("../../../../keystatic.config");
    handler = makeRouteHandler({ config });
  }

  return handler;
}

export async function GET(req: Request) {
  const routeHandler = await getHandler();
  if (routeHandler instanceof Response) return routeHandler;
  return routeHandler.GET(req);
}

export async function POST(req: Request) {
  const routeHandler = await getHandler();
  if (routeHandler instanceof Response) return routeHandler;
  return routeHandler.POST(req);
}

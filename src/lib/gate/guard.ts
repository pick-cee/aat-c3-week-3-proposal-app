import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./config";
import { GATE_COOKIE, GATE_PATH, gateEnv, sessionIsValid } from "./core";

/**
 * Called first in middleware. Returns what to send instead when the visitor hasn't signed in to the
 * gate, or null to carry on. Pages redirect to the sign-in screen and come back afterwards; API routes
 * and server actions get a 401, so nothing that spends money runs without a session.
 */
export async function gateRequest(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (pathname === GATE_PATH || pathname.startsWith(`${GATE_PATH}/`)) return null;
  if (isPublicPath(pathname, request.headers)) return null;
  if (await sessionIsValid(request.cookies.get(GATE_COOKIE)?.value, gateEnv())) return null;

  const isPage = (request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/") && !request.headers.has("next-action");
  if (isPage) {
    const url = new URL(GATE_PATH, request.url);
    if (pathname + search !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "This demo is private. Sign in at /gate first." }, { status: 401, headers: { "cache-control": "no-store" } });
}

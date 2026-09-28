import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_PATH, SESSION_DAYS, createSession, credentialsMatch, gateEnv, safeNext } from "@/lib/gate/core";
import { gatePage, type GateNotice } from "@/lib/gate/page";

// The sign-in screen (GET) and the sign-in itself (POST). `?sign-out` clears the session.
export const dynamic = "force-dynamic";

function html(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "same-origin" },
  });
}

// A best-effort brake on guessing, per server instance: every miss waits, and ten misses from one
// address in fifteen minutes lock that address out until the window passes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_MISSES = 10;
const misses = new Map<string, { count: number; since: number }>();

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function isLockedOut(address: string, now = Date.now()): boolean {
  const entry = misses.get(address);
  if (!entry) return false;
  if (now - entry.since > WINDOW_MS) {
    misses.delete(address);
    return false;
  }
  return entry.count >= MAX_MISSES;
}

function recordMiss(address: string, now = Date.now()) {
  const entry = misses.get(address);
  if (!entry || now - entry.since > WINDOW_MS) misses.set(address, { count: 1, since: now });
  else entry.count += 1;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? request.nextUrl.host);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.has("sign-out")) {
    const response = NextResponse.redirect(new URL(`${GATE_PATH}?notice=signed-out`, request.url), 303);
    response.cookies.delete(GATE_COOKIE);
    return response;
  }
  const notice: GateNotice = !gateEnv() ? "unconfigured" : params.get("notice") === "signed-out" ? "signed-out" : null;
  return html(gatePage({ next: safeNext(params.get("next")), notice }));
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const email = String(form?.get("email") ?? "").slice(0, 320);
  const password = String(form?.get("password") ?? "").slice(0, 512);

  const env = gateEnv();
  if (!env) return html(gatePage({ next, notice: "unconfigured" }), 503);

  // A form on another site can't sign a visitor in here.
  if (!sameOrigin(request)) return html(gatePage({ next, notice: null }), 403);

  const address = clientAddress(request);
  if (isLockedOut(address)) return html(gatePage({ next, notice: "throttled", email }), 429);

  if (!(await credentialsMatch(env, email, password))) {
    recordMiss(address);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return html(gatePage({ next, notice: "wrong", email }), 401);
  }

  misses.delete(address);
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(GATE_COOKIE, await createSession(env), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}

/**
 * The access gate in front of the whole demo.
 *
 * The live demo spends real money on model and scraping calls, and the link is public on a portfolio. So
 * nothing runs until a visitor signs in once with the owner's demo credentials. This sits in front of
 * the app's own sign-in, not instead of it.
 *
 * Runs in middleware (Edge on Next 15, Node on Next 16) and in route handlers, so it uses Web Crypto
 * only: no Node imports. Credentials come from the environment, never the code: GATE_EMAIL and
 * GATE_PASSWORD are required, GATE_SECRET is optional extra key material. With either required value
 * missing the gate fails closed and nothing is reachable, because an unconfigured gate that lets
 * everyone through is exactly the spend path it exists to close.
 */

export const GATE_COOKIE = "gate_session";
export const GATE_PATH = "/gate";
export const SESSION_DAYS = 30;

export type GateEnv = { email: string; password: string; secret: string };

export function gateEnv(env: Record<string, string | undefined> = process.env): GateEnv | null {
  const email = env.GATE_EMAIL?.trim().toLowerCase();
  const password = env.GATE_PASSWORD;
  if (!email || !password) return null;
  return { email, password, secret: env.GATE_SECRET ?? "" };
}

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The signing key covers the credentials too, so changing the password signs everyone out.
async function hmac(env: GateEnv, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${env.secret}\n${env.email}\n${env.password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

// Equal-time comparison: both sides are hashed to the same length, then every byte is compared.
async function sameText(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function credentialsMatch(env: GateEnv, email: string, password: string): Promise<boolean> {
  const [emailOk, passwordOk] = await Promise.all([
    sameText(email.trim().toLowerCase(), env.email),
    sameText(password, env.password),
  ]);
  return emailOk && passwordOk;
}

// A session is "v1.<expiry in seconds>.<signature>". Nothing secret is inside it.
export async function createSession(env: GateEnv, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const body = `v1.${expires}`;
  return `${body}.${await hmac(env, body)}`;
}

export async function sessionIsValid(token: string | undefined, env: GateEnv | null, now = Date.now()): Promise<boolean> {
  if (!token || !env) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires * 1000 <= now) return false;
  return sameText(parts[2] ?? "", await hmac(env, `v1.${parts[1]}`));
}

// Where to go after signing in: a path on this site only, never another origin, never the gate itself.
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === GATE_PATH || value.startsWith(`${GATE_PATH}/`) || value.startsWith(`${GATE_PATH}?`)) return "/";
  return value;
}

// How the access gate looks in this app, and what stays reachable without it.
export const GATE_BRAND = { client: "Koya Talent", product: "Proposals", accent: "#0f172a", ink: "#0f172a", bg: "#f4f6f9", accentDark: "#e2e8f0" };

// Public without the gate: nothing here calls a model or spends money.
//   /p/<token>  the client's view of a sent proposal, opened from the email by someone with no account.
export function isPublicPath(pathname: string, _headers: Headers): boolean {
  return pathname.startsWith("/p/");
}

import { GATE_PATH } from "./core";
import { GATE_BRAND } from "./config";

/**
 * The sign-in screen, as a complete HTML page. It is served by a route handler, not rendered inside the
 * app's layout, so it never depends on the app's own session, navigation or data. Plain HTML form: it
 * works with JavaScript off. Light and dark follow the system setting.
 */

export type GateNotice = "wrong" | "throttled" | "unconfigured" | "signed-out" | null;

const NOTICES: Record<Exclude<GateNotice, null>, { tone: "error" | "info"; text: string }> = {
  wrong: { tone: "error", text: "That email and password don't match. Try again." },
  throttled: { tone: "error", text: "Too many attempts. Wait a few minutes, then try again." },
  unconfigured: { tone: "error", text: "Sign-in isn't set up on this deployment yet." },
  "signed-out": { tone: "info", text: "You're signed out." },
};

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function gatePage({ next, notice, email = "" }: { next: string; notice: GateNotice; email?: string }): string {
  const b = GATE_BRAND;
  const message = notice ? NOTICES[notice] : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${b.bg}">
<title>Sign in · ${escape(b.product)}</title>
<style>
  :root { --bg: ${b.bg}; --card: #ffffff; --ink: ${b.ink}; --muted: color-mix(in srgb, ${b.ink} 62%, #ffffff); --line: color-mix(in srgb, ${b.ink} 14%, #ffffff); --accent: ${b.accent}; --on-accent: #ffffff; --error: #b3261e; --error-bg: #fdecea; --info-bg: color-mix(in srgb, ${b.accent} 10%, #ffffff); color-scheme: light; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111513; --card: #1a1f1c; --ink: #eef1ec; --muted: #a9b2ab; --line: #2c332f; --accent: ${b.accentDark}; --on-accent: #0d110f; --error: #ffb4ab; --error-bg: #3a1d1a; --info-bg: color-mix(in srgb, ${b.accent} 22%, #1a1f1c); color-scheme: dark; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
    background:
      radial-gradient(1100px 520px at 12% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
      radial-gradient(900px 480px at 110% 110%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 60%),
      var(--bg);
  }
  main { width: 100%; max-width: 420px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 36px 32px 30px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 24px 60px -24px rgb(0 0 0 / 0.28); }
  .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 999px; background: var(--info-bg); color: var(--accent); font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
  .badge svg { width: 15px; height: 15px; }
  .client { margin: 22px 0 0; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 4px 0 0; font: 600 30px/1.15 "Iowan Old Style", "Palatino Linotype", Georgia, serif; letter-spacing: -0.01em; }
  .lede { margin: 12px 0 0; color: var(--muted); font-size: 15px; }
  form { margin-top: 26px; display: grid; gap: 16px; }
  label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
  input { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--ink); font: inherit; transition: border-color 150ms, box-shadow 150ms; }
  input:hover { border-color: color-mix(in srgb, var(--ink) 30%, var(--card)); }
  input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }
  button { margin-top: 6px; padding: 14px 16px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-family: inherit; font-size: 16px; font-weight: 600; line-height: 1; cursor: pointer; transition: filter 150ms, transform 150ms; }
  button:hover { filter: brightness(1.08); }
  button:active { transform: translateY(1px); }
  button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 3px; }
  .notice { margin: 20px 0 0; padding: 11px 14px; border-radius: 12px; font-size: 14px; }
  .notice.error { background: var(--error-bg); color: var(--error); }
  .notice.info { background: var(--info-bg); color: var(--ink); }
  footer { margin-top: 22px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; padding: 0 6px; font-size: 13px; color: var(--muted); }
  footer a { color: inherit; text-underline-offset: 3px; }
  footer a:hover { color: var(--ink); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<main>
  <div class="card">
    <span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Private demo</span>
    <p class="client">${escape(b.client)}</p>
    <h1>${escape(b.product)}</h1>
    <p class="lede">This demo runs on paid AI, so it sits behind a sign-in. Use the details you were given.</p>
    ${message ? `<p class="notice ${message.tone}" role="${message.tone === "error" ? "alert" : "status"}">${message.text}</p>` : ""}
    <form method="post" action="${GATE_PATH}">
      <input type="hidden" name="next" value="${escape(next)}">
      <label>Email<input type="email" name="email" autocomplete="username" required value="${escape(email)}"${notice === "wrong" ? "" : " autofocus"}></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required${notice === "wrong" ? " autofocus" : ""}></label>
      <button type="submit">Sign in</button>
    </form>
  </div>
  <footer>
    <span>Built by <a href="https://akinloluwa.dev" rel="noopener">Akinloluwa Olumuyide</a></span>
    <a href="https://akinloluwa.dev/#contact" rel="noopener">Need access? Get in touch</a>
  </footer>
</main>
</body>
</html>`;
}

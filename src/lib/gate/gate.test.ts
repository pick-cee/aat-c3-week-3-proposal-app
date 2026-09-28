import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/gate/config";
import { createSession, credentialsMatch, gateEnv, safeNext, sessionIsValid } from "@/lib/gate/core";
import { gatePage } from "@/lib/gate/page";

const env = gateEnv({ GATE_EMAIL: " Owner@Example.com ", GATE_PASSWORD: "correct horse", GATE_SECRET: "s3cret" })!;

describe("access gate", () => {
  it("fails closed when the credentials aren't configured", async () => {
    expect(gateEnv({})).toBeNull();
    expect(gateEnv({ GATE_EMAIL: "a@b.c" })).toBeNull();
    expect(await sessionIsValid("v1.9999999999.x", null)).toBe(false);
  });

  it("accepts the configured email (any case, trimmed) with the exact password", async () => {
    expect(await credentialsMatch(env, "owner@example.com", "correct horse")).toBe(true);
    expect(await credentialsMatch(env, "  OWNER@example.COM ", "correct horse")).toBe(true);
    expect(await credentialsMatch(env, "owner@example.com", "Correct horse")).toBe(false);
    expect(await credentialsMatch(env, "someone@example.com", "correct horse")).toBe(false);
    expect(await credentialsMatch(env, "", "")).toBe(false);
  });

  it("issues a session that verifies, and rejects tampered, expired or re-keyed ones", async () => {
    const now = Date.UTC(2026, 8, 29);
    const token = await createSession(env, now);
    expect(await sessionIsValid(token, env, now)).toBe(true);
    expect(await sessionIsValid(token, env, now + 29 * 86_400_000)).toBe(true);
    expect(await sessionIsValid(token, env, now + 31 * 86_400_000)).toBe(false);
    const [v, exp, sig] = token.split(".");
    expect(await sessionIsValid(`${v}.${Number(exp) + 999}.${sig}`, env, now)).toBe(false);
    expect(await sessionIsValid(`${v}.${exp}.${sig}x`, env, now)).toBe(false);
    expect(await sessionIsValid("garbage", env, now)).toBe(false);
    const changedPassword = gateEnv({ GATE_EMAIL: "owner@example.com", GATE_PASSWORD: "changed", GATE_SECRET: "s3cret" })!;
    expect(await sessionIsValid(token, changedPassword, now)).toBe(false);
  });

  it("only sends a signed-in visitor back to a path on this site", () => {
    expect(safeNext("/runs/42?tab=leads")).toBe("/runs/42?tab=leads");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/gate")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("escapes what it echoes back into the sign-in page", () => {
    const page = gatePage({ next: '/x"><script>alert(1)</script>', notice: "wrong", email: "<b>" });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;b&gt;");
    expect(page).toContain("That email and password don't match.");
  });

  it("keeps nothing that spends money outside the gate", () => {
    const none = new Headers();
    for (const path of ["/", "/api/runs", "/api/runner", "/queue", "/proposals/new", "/requests/new", "/runs/new", "/settings"]) {
      if (path === "/api/runner") continue; // checked per app: only public with its own secret
      expect(isPublicPath(path, none), path).toBe(false);
    }
  });
});

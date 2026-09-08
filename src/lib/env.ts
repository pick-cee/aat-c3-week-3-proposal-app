import "server-only";

import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  RESEND_FROM_ADDRESS: z
    .string()
    .email("RESEND_FROM_ADDRESS must be an email address"),

  // Demo mode defaults to ON. A missing or malformed value must not be the
  // thing that lets this application email a stranger, so only the exact
  // string "false" disables it.
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  DEMO_REDIRECT_EMAIL: z
    .string()
    .email("DEMO_REDIRECT_EMAIL must be an email address"),

  NEXT_PUBLIC_SITE_URL: z.string().url("NEXT_PUBLIC_SITE_URL must be a URL"),
});

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? "(unknown variable)");
      const absent = process.env[name] === undefined || process.env[name] === "";

      return absent
        ? `  - ${name} is missing`
        : `  - ${name}: ${issue.message}`;
    });

    throw new Error(
      `Environment is not configured.\n${problems.join("\n")}\n\n` +
      `Copy .env.example to .env.local and fill it in. ` +
      `On Vercel these are project environment variables.`,
    );
  }

  return parsed.data;
}

export const env = load();

export function resolveRecipient(intended: string): {
  intended: string;
  actual: string;
  demoMode: boolean;
} {
  return {
    intended,
    actual: env.DEMO_MODE ? env.DEMO_REDIRECT_EMAIL : intended,
    demoMode: env.DEMO_MODE,
  };
}

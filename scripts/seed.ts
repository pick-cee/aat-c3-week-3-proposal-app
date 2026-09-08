import { createClient } from "@supabase/supabase-js";

import { DEMO_ACCOUNTS } from "../src/lib/demo-accounts";

export interface SeedOptions {
  /** Suppress per-account chatter when called as part of a larger run. */
  quiet?: boolean;
}

export interface SeedResult {
  created: number;
  alreadyPresent: number;
}

export async function seedDemoAccounts(
  options: SeedOptions = {},
): Promise<SeedResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  const log = (message: string) => {
    if (!options.quiet) console.log(message);
  };

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Listed once rather than per account: two round trips for two accounts is
  // wasteful, and this runs on every boot.
  const { data: existing, error: listError } = await db.auth.admin.listUsers();

  if (listError) {
    throw new Error(`Could not list existing users: ${listError.message}`);
  }

  const byEmail = new Map(
    (existing?.users ?? []).map((user) => [user.email, user]),
  );

  let created = 0;
  let alreadyPresent = 0;
  const failures: string[] = [];

  for (const account of DEMO_ACCOUNTS) {
    const already = byEmail.get(account.email);
    let userId: string;

    if (already) {
      userId = already.id;
      alreadyPresent += 1;
      log(`· ${account.email} already exists`);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true, // no inbox exists for these addresses
      });

      if (error || !data.user) {
        failures.push(`${account.email}: ${error?.message ?? "no user returned"}`);
        continue;
      }

      userId = data.user.id;
      created += 1;
      log(`✓ created ${account.email}`);
    }

    // Upserted every time, not just on creation: the profile carries the role,
    // and a user whose profile row went missing would be signed in with no
    // permissions and no obvious cause.
    const { error: profileError } = await db.from("profiles").upsert({
      id: userId,
      full_name: account.fullName,
      role: account.role,
    });

    if (profileError) {
      failures.push(`profile for ${account.email}: ${profileError.message}`);
      continue;
    }

    log(`  profile: ${account.fullName} (${account.role})`);
  }

  if (failures.length > 0) {
    throw new Error(`Seed incomplete:\n  ${failures.join("\n  ")}`);
  }

  return { created, alreadyPresent };
}

/**
 * Only self-runs when invoked directly (`npm run seed`), so importing this
 * module from the migration runner does not trigger a run or an exit.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  /scripts[/\\]seed\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  seedDemoAccounts()
    .then((result) => {
      console.log(
        `\nSeed complete — ${result.created} created, ` +
        `${result.alreadyPresent} already present.`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}

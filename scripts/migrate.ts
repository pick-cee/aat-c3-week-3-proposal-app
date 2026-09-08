import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "supabase", "migrations");

/** Arbitrary but fixed: two processes must pick the same number to exclude each other. */
const ADVISORY_LOCK_KEY = 8_472_119_003;

const strict =
  process.argv.includes("--strict") || process.env.MIGRATE_STRICT === "true";
const dryRun = process.argv.includes("--dry-run");
const skipSeed = process.argv.includes("--no-seed");

interface Migration {
  name: string;
  sql: string;
  /** Detects a migration edited after it was applied. */
  checksum: string;
}

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    // Not an error: local development against a hosted Supabase project often
    // has no direct Postgres URL, and the app runs fine without one.
    report(
      "info",
      "No SUPABASE_DB_URL (or DATABASE_URL) set — skipping migrations.\n" +
      "  Set it to your Supabase connection string to apply migrations on start.",
    );
    return;
  }

  const migrations = await loadMigrations();
  if (migrations.length === 0) {
    report("info", "No migration files found.");
    return;
  }

  const client = new Client({
    connectionString,
    // Supabase requires TLS but presents a certificate chain Node does not
    // bundle. This is the connection string the platform itself issues.
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    // A boot-time task must not hang the deploy if the database is unreachable.
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  });

  await client.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);

    try {
      await ensureMigrationsTable(client);
      const applied = await appliedMigrations(client);
      await verifyNoDrift(migrations, applied);

      const pending = migrations.filter((m) => !applied.has(m.name));

      if (pending.length === 0) {
        report("ok", `Schema is up to date (${applied.size} migrations applied).`);
      } else if (dryRun) {
        report(
          "info",
          `Would apply ${pending.length} migration(s):\n` +
          pending.map((m) => `    ${m.name}`).join("\n"),
        );
      } else {
        for (const migration of pending) {
          await applyMigration(client, migration);
        }
        report("ok", `Applied ${pending.length} migration(s).`);
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }

  if (!skipSeed && !dryRun) {
    await runSeed();
  }
}

async function loadMigrations(): Promise<Migration[]> {
  const filenames = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    // Lexicographic order is the apply order, which is why they are numbered.
    .sort();

  return Promise.all(
    filenames.map(async (name) => {
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex").slice(0, 16),
      };
    }),
  );
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedMigrations(
  client: Client,
): Promise<Map<string, string>> {
  const { rows } = await client.query<{ name: string; checksum: string }>(
    "select name, checksum from schema_migrations",
  );
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

/**
 * An applied migration whose file has since changed is a real problem: the
 * database and the repository disagree about what the schema is, and nothing
 * will ever reconcile them because the migration will not run again.
 *
 * Warned about rather than thrown, because refusing to boot over it would take
 * a running application down for something that needs a human decision.
 */
async function verifyNoDrift(
  migrations: Migration[],
  applied: Map<string, string>,
): Promise<void> {
  const changed = migrations.filter(
    (m) => applied.has(m.name) && applied.get(m.name) !== m.checksum,
  );

  if (changed.length > 0) {
    report(
      "warn",
      `These migrations were edited after being applied, so the database no ` +
      `longer matches the repository:\n` +
      changed.map((m) => `    ${m.name}`).join("\n") +
      `\n  Write a NEW migration to make the change instead — editing an ` +
      `applied one has no effect on a database that already ran it.`,
    );
  }
}

async function applyMigration(
  client: Client,
  migration: Migration,
): Promise<void> {
  // Each migration is one transaction: it applies completely or not at all,
  // and its bookkeeping row commits with it. A crash mid-file cannot leave a
  // half-applied migration recorded as done.
  await client.query("begin");

  try {
    await client.query(migration.sql);
    await client.query(
      "insert into schema_migrations (name, checksum) values ($1, $2)",
      [migration.name, migration.checksum],
    );
    await client.query("commit");
    report("ok", `Applied ${migration.name}`);
  } catch (error) {
    await client.query("rollback");
    throw new Error(
      `${migration.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Seeding runs through the existing script rather than being reimplemented
 * here, so there is one definition of what a demo account is.
 */
async function runSeed(): Promise<void> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    report("info", "Supabase API keys not set — skipping demo account seed.");
    return;
  }

  try {
    const { seedDemoAccounts } = await import("./seed");
    const result = await seedDemoAccounts({ quiet: true });

    report(
      "ok",
      result.created > 0
        ? `Demo accounts ready (${result.created} created).`
        : "Demo accounts already present.",
    );
  } catch (error) {
    // A failed seed leaves an application that runs but cannot be signed into.
    // Worth reporting clearly; not worth refusing to start over.
    report(
      "warn",
      `Could not seed the demo accounts: ${error instanceof Error ? error.message : String(error)
      }\n  Sign-in will fail until \`npm run seed\` succeeds.`,
    );
  }
}

/**
 * Turns a connection failure into something actionable.
 *
 * The raw errors here are unusually unhelpful. `getaddrinfo ENOENT
 * db.<ref>.supabase.co` reads like a typo, but the real cause is almost always
 * that Supabase's DIRECT database host is IPv6-only while the machine (or its
 * network, or its CI runner) has no IPv6 route. The name resolves — to an AAAA
 * record nothing can reach — so "host not found" is actively misleading.
 */
function explainConnectionFailure(
  error: unknown,
  connectionString: string,
): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const host = hostOf(connectionString);

  const isDirectSupabaseHost = /^db\.[a-z0-9]+\.supabase\.co$/i.test(host ?? "");
  const isPooler = /pooler\.supabase\.com$/i.test(host ?? "");

  if (/ENOTFOUND|EAI_AGAIN|ENOENT/i.test(message) && isDirectSupabaseHost) {
    const ref = host!.split(".")[1];
    return (
      `"${host}" is Supabase's DIRECT connection host, which is IPv6-only. ` +
      `This machine has no working IPv6 route, so the name resolves to an ` +
      `address nothing can reach — which Node reports as if the host did not ` +
      `exist.\n` +
      `  Use the SESSION POOLER instead, which is reachable over IPv4:\n` +
      `    Supabase dashboard → Project Settings → Database → Connection string\n` +
      `    → URI, and pick "Session pooler" (NOT "Direct connection").\n` +
      `  It looks like:\n` +
      `    postgresql://postgres.${ref}:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres\n` +
      `  Port 5432 (session), not 6543 (transaction) — migrations need advisory ` +
      `locks, which transaction pooling does not support.`
    );
  }

  if (/ENOTFOUND|EAI_AGAIN|ENOENT/i.test(message)) {
    return `"${host}" could not be resolved. Check the host in SUPABASE_DB_URL.`;
  }

  if (/password authentication failed|SASL|SCRAM/i.test(message)) {
    return (
      `The database password was rejected. It is NOT the anon key or the ` +
      `service-role key — it is the separate database password, which can be ` +
      `reset under Project Settings → Database.` +
      (isPooler
        ? `\n  On the pooler the username also includes the project ref: ` +
        `"postgres.<ref>", not plain "postgres".`
        : "")
    );
  }

  if (/ECONNREFUSED/i.test(message)) {
    return (
      `Nothing is listening at ${host}. If this is the pooler, check the port ` +
      `— 5432 is session mode, 6543 is transaction mode.`
    );
  }

  if (/prepared statement|does not support|unnamed prepared/i.test(message)) {
    return (
      `This looks like the TRANSACTION pooler (port 6543). Migrations need ` +
      `session-level advisory locks, which it does not support. Use port 5432.`
    );
  }

  return null;
}

function hostOf(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
}

function report(level: "ok" | "info" | "warn" | "error", message: string): void {
  const prefix = { ok: "✓", info: "·", warn: "!", error: "✗" }[level];
  const line = `[migrate] ${prefix} ${message}`;

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    report(
      "error",
      error instanceof Error ? error.message : String(error),
    );

    const connectionString =
      process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

    if (connectionString) {
      const explanation = explainConnectionFailure(error, connectionString);
      if (explanation) report("info", explanation);
    }

    if (strict) {
      report("error", "Exiting non-zero because --strict was set.");
      process.exit(1);
    }

    // The default path. The application starts; the failure is on the log.
    // Refusing to boot would turn a transient database blip into an outage.
    report(
      "warn",
      "Starting anyway. The application will fail on any database access " +
      "until this is resolved.",
    );
    process.exit(0);
  });

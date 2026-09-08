"use server";

import { redirect } from "next/navigation";

import { demoAccountFor } from "@/lib/demo-accounts";
import { getServerClient } from "@/lib/db/server";
import type { UserRole } from "@/lib/db/types";

/**
 * One-click demo sign-in.
 *
 * Signs in as the pre-seeded account for a role. DESIGN.md section 3 chooses
 * this over magic links because the live link has to work for a grader with no
 * account and no inbox we control — a magic link would strand them.
 *
 * The role comes from the form, but the credentials never do: the client sends
 * "salesperson", and the server decides what that means. A client that could
 * post its own email and password would be a sign-in form, not a demo button.
 */
export async function signInAsDemo(formData: FormData) {
  const role = formData.get("role");

  if (role !== "salesperson" && role !== "approver") {
    throw new Error(`Unknown demo role: ${String(role)}`);
  }

  const account = demoAccountFor(role as UserRole);
  const db = await getServerClient();

  const { error } = await db.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });

  if (error) {
    // Almost always means the seed has not been run against this project.
    // Say so, rather than showing a generic auth failure that sends someone
    // hunting through Supabase settings.
    throw new Error(
      `Could not sign in as the demo ${role}. ` +
        `If this is a fresh deployment, run \`npm run seed\` to create the ` +
        `demo accounts. (${error.message})`,
    );
  }

  redirect("/queue");
}

export async function signOut() {
  const db = await getServerClient();
  await db.auth.signOut();
  redirect("/");
}

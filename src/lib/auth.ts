import "server-only";

import { redirect } from "next/navigation";

import { getServerClient } from "@/lib/db/server";
import type { Profile, UserRole } from "@/lib/db/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const db = await getServerClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return (profile as Profile | null) ?? null;
}

/**
 * Same, but redirects to the landing page when signed out. For pages and
 * actions where being signed in is a precondition rather than a branch.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/");
  return profile;
}

export async function requireRole(role: UserRole): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== role) redirect("/queue");
  return profile;
}

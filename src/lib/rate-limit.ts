import "server-only";

import { GENERATIONS_PER_HOUR_GLOBAL } from "@/lib/constants";
import { getAdminClient } from "@/lib/db/admin";
import { formatTime } from "@/lib/format";

const BILLABLE_EVENTS = [
  "intake_extracted", // Sonnet, once per proposal, on the public notes screen
  "material_summarized", // Haiku, once per uploaded file
  "generated", // Sonnet, once per written section
  "regenerated", // Sonnet, each regeneration
  "generation_rejected", // Sonnet, a fabrication caught and retried
  "generation_failed",
] as const;

export type RateLimitResult =
  | { allowed: true; used: number; limit: number; remaining: number }
  | { allowed: false; used: number; limit: number; resetsAt: Date };

/**
 * Uses the admin client deliberately: the count spans every user's activity,
 * which no single user's RLS view can see. This is one of the narrow
 * legitimate uses documented in `db/admin.ts`.
 */
export async function checkRateLimit(): Promise<RateLimitResult> {
  const db = getAdminClient();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);

  const { count, error } = await db
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .in("event", BILLABLE_EVENTS)
    .gte("created_at", windowStart.toISOString());

  if (error) {
    // Fail CLOSED. If we cannot count what we have spent, we do not spend more:
    // an unavailable limiter is exactly when an abusive caller would want us to
    // keep generating. The message says this is temporary so a user does not
    // read it as the hard hourly cap.
    throw new RateLimitUnavailableError(error.message);
  }

  const used = count ?? 0;

  if (used >= GENERATIONS_PER_HOUR_GLOBAL) {
    return {
      allowed: false,
      used,
      limit: GENERATIONS_PER_HOUR_GLOBAL,
      resetsAt: await oldestCallInWindow(windowStart),
    };
  }

  return {
    allowed: true,
    used,
    limit: GENERATIONS_PER_HOUR_GLOBAL,
    remaining: GENERATIONS_PER_HOUR_GLOBAL - used,
  };
}

/**
 * When the window frees up: one hour after the oldest call still inside it.
 * DESIGN.md requires the message to name a specific time — "try again later"
 * is what a broken button says.
 */
async function oldestCallInWindow(windowStart: Date): Promise<Date> {
  const db = getAdminClient();

  const { data } = await db
    .from("activity_log")
    .select("created_at")
    .in("event", BILLABLE_EVENTS)
    .gte("created_at", windowStart.toISOString())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const oldest = data?.created_at ? new Date(data.created_at) : windowStart;
  return new Date(oldest.getTime() + 60 * 60 * 1000);
}

export class RateLimitUnavailableError extends Error {
  constructor(cause: string) {
    super(
      "Could not check the generation limit, so generation is paused. " +
      "This is a temporary server problem, not the hourly cap. " +
      `Details: ${cause}`,
    );
    this.name = "RateLimitUnavailableError";
  }
}

/** The user-facing message. Says what happened, when it lifts, and what is safe. */
export function rateLimitMessage(result: RateLimitResult & { allowed: false }) {
  const time = formatTime(result.resetsAt);

  return (
    `This application has hit its hourly generation limit ` +
    `(${result.limit} model calls per hour, shared across everyone using it). ` +
    `New generation resumes at ${time}. ` +
    `Nothing has been lost — every proposal and section already generated is ` +
    `unaffected and still viewable.`
  );
}

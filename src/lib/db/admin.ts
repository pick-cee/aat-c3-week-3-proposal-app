import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

export function getAdminClient() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

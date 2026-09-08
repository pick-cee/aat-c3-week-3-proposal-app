import type { UserRole } from "@/lib/db/types";

export interface DemoAccount {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  /** One line explaining the role, shown on the sign-in button. */
  blurb: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "sam@koyatalent.demo",
    password: "demo-salesperson-2026",
    fullName: "Sam Okafor",
    role: "salesperson",
    blurb: "Writes proposals, generates sections, and sends once approved.",
  },
  {
    email: "avery@koyatalent.demo",
    password: "demo-approver-2026",
    fullName: "Avery Lindqvist",
    role: "approver",
    blurb: "Reviews and approves. Cannot edit, and does not send.",
  },
] as const;

export function demoAccountFor(role: UserRole): DemoAccount {
  const account = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!account) throw new Error(`No demo account seeded for role: ${role}`);
  return account;
}

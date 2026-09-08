import type { IntakeFields } from "@/lib/db/types";


export interface Fabrication {
  /** The exact token found in the generated text. */
  token: string;
  kind: "currency" | "date";
}

export interface NameWarning {
  field: "client_name" | "company_name" | "client_email";
  expected: string;
  /** What the section says instead, when we can identify it. */
  note: string;
}

export interface VerificationResult {
  /** Fabricated numbers or dates. Non-empty means the section is rejected. */
  fabrications: Fabrication[];
  /** Paraphrased or missing names. Surfaced for a human, never blocking. */
  warnings: NameWarning[];
  ok: boolean;
}

/**
 * Currency-shaped tokens: a symbol with digits, or digits with a currency word.
 *
 * Deliberately broad. A false positive costs one retry; a false negative puts a
 * number the salesperson never approved in front of a client.
 */
const CURRENCY_PATTERNS: RegExp[] = [
  // £48,000 · $1,200.50 · €900 · ₦2,000,000
  /[£$€¥₦₹]\s?\d[\d,]*(?:\.\d+)?[kKmM]?/g,
  // 48,000 GBP · 1200 USD · 900 euros · 50k dollars
  /\d[\d,]*(?:\.\d+)?[kKmM]?\s?(?:GBP|USD|EUR|NGN|INR|JPY|pounds?|dollars?|euros?|naira)\b/gi,
];

/**
 * Date-shaped tokens: written months, numeric dates, quarters, and durations
 * expressed as a span of time.
 */
const DATE_PATTERNS: RegExp[] = [
  // 12 March 2026 · March 12, 2026 · 3 Mar 2026
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
  // 2026-03-12 · 12/03/2026 · 12-03-26
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  // Q1 2026 · Q3
  /\bQ[1-4](?:\s+\d{4})?\b/g,
  // 10 weeks · six months · 3-4 weeks — a committed duration is a commitment.
  /\b\d+(?:\s?[-–]\s?\d+)?\s+(?:day|week|month|year)s?\b/gi,
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:day|week|month|year)s?\b/gi,
  // Bare years, which is how "delivery in 2027" sneaks in.
  /\b(?:19|20)\d{2}\b/g,
];

/**
 * Normalized so trivial formatting differences do not read as fabrication.
 * "£48,000" and "£48000" and "GBP 48,000" all reduce to the same digits.
 */
function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\s,]/g, "")
    .replace(/[£$€¥₦₹]/g, "")
    .replace(/(gbp|usd|eur|ngn|inr|jpy|pounds?|dollars?|euros?|naira)/g, "")
    .trim();
}

/** Every commercial-looking token the intake authorises the model to use. */
function authorizedTokens(intake: Partial<IntakeFields>): Set<string> {
  const authorized = new Set<string>();

  // The whole intake is the source of truth, not just the pricing field: a date
  // mentioned in the scope is a date the salesperson wrote down.
  const source = Object.values(intake)
    .filter((v): v is string => typeof v === "string")
    .join("\n");

  for (const pattern of [...CURRENCY_PATTERNS, ...DATE_PATTERNS]) {
    for (const match of source.matchAll(pattern)) {
      authorized.add(normalizeToken(match[0]));
    }
  }

  // Bare digit runs from the intake are authorised too. A price written as
  // "48000 for the build" has no symbol, but the model repeating "48,000" is
  // quoting rather than inventing.
  for (const match of source.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    authorized.add(normalizeToken(match[0]));
  }

  return authorized;
}

export function verifyCommercialTerms(
  content: string,
  intake: Partial<IntakeFields>,
): VerificationResult {
  const authorized = authorizedTokens(intake);
  const fabrications: Fabrication[] = [];
  const seen = new Set<string>();

  const scan = (patterns: RegExp[], kind: Fabrication["kind"]) => {
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const token = match[0];
        const normalized = normalizeToken(token);

        if (normalized === "" || authorized.has(normalized)) continue;
        if (seen.has(normalized)) continue;

        seen.add(normalized);
        fabrications.push({ token, kind });
      }
    }
  };

  scan(CURRENCY_PATTERNS, "currency");
  scan(DATE_PATTERNS, "date");

  return {
    fabrications,
    warnings: checkNames(content, intake),
    ok: fabrications.length === 0,
  };
}

/**
 * Names: present in some recognisable form, or warn.
 *
 * Containment on a normalized string, and a first-word fallback so "Acme" is
 * accepted for "Acme Corp Ltd". This is looser than the number check on
 * purpose — a paraphrased company name is a style question for a human, not a
 * fabrication.
 */
function checkNames(
  content: string,
  intake: Partial<IntakeFields>,
): NameWarning[] {
  const warnings: NameWarning[] = [];
  const haystack = content.toLowerCase().replace(/\s+/g, " ");

  const check = (
    field: NameWarning["field"],
    value: string | null | undefined,
    label: string,
  ) => {
    const expected = (value ?? "").trim();
    if (expected === "") return;

    const needle = expected.toLowerCase().replace(/\s+/g, " ");
    if (haystack.includes(needle)) return;

    // "Acme" satisfies "Acme Corp Ltd" — the distinctive part is present.
    const firstWord = needle.split(" ")[0]!;
    if (firstWord.length >= 3 && haystack.includes(firstWord)) return;

    warnings.push({
      field,
      expected,
      note: `This section does not mention the ${label} as written on the intake ("${expected}"). Check it reads correctly before sending.`,
    });
  };

  check("client_name", intake.client_name, "client name");
  check("company_name", intake.company_name, "company name");

  return warnings;
}

/** The rejection message written to the activity log and shown on the section. */
export function describeFabrications(fabrications: Fabrication[]): string {
  const list = fabrications.map((f) => `"${f.token}"`).join(", ");

  return (
    `The model wrote ${list}, which ${fabrications.length === 1 ? "does" : "do"
    } not appear anywhere in the intake. ` +
    `Figures and dates must come from the salesperson, never the model.`
  );
}

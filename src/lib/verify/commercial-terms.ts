import type { IntakeFields, SectionKey } from "@/lib/db/types";


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
  /**
   * Which section this is. Optional so existing callers keep working, but the
   * name check needs it — see `checkNames`. Without it, name warnings are
   * skipped rather than guessed.
   */
  sectionKey?: SectionKey,
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
    warnings: checkNames(content, intake, sectionKey),
    ok: fabrications.length === 0,
  };
}

/**
 * Names: present in some recognisable form, or warn.
 *
 * Containment on a normalized string, and a first-word fallback so "Acme" is
 * accepted for "Acme Corp Ltd". Looser than the number check on purpose — a
 * paraphrased company name is a style question for a human, not a fabrication.
 *
 * WHICH sections are checked matters as much as how.
 *
 * The contact's personal name belongs in the sections that address them — the
 * opening and the close. Deliverables is a list of things; naming Grace in it
 * would be strange, and warning that it does not is telling a salesperson to
 * fix prose that is already right. A checker that fires on correct output
 * teaches people to ignore it, which costs more than it ever saves.
 *
 * The company name is different: it is the subject of the whole document, so
 * every section may reasonably carry it, and none is required to.
 */
function checkNames(
  content: string,
  intake: Partial<IntakeFields>,
  sectionKey?: SectionKey,
): NameWarning[] {
  const warnings: NameWarning[] = [];
  const haystack = content.toLowerCase().replace(/\s+/g, " ");

  const mentions = (value: string): boolean => {
    const needle = value.toLowerCase().replace(/\s+/g, " ");
    if (haystack.includes(needle)) return true;

    // "Acme" satisfies "Acme Corp Ltd" — the distinctive part is present.
    const firstWord = needle.split(" ")[0]!;
    return firstWord.length >= 3 && haystack.includes(firstWord);
  };

  const check = (
    field: NameWarning["field"],
    value: string | null | undefined,
    label: string,
  ) => {
    const expected = (value ?? "").trim();
    if (expected === "" || mentions(expected)) return;

    warnings.push({
      field,
      expected,
      note: `This section does not mention the ${label} as written on the intake ("${expected}"). Check it reads correctly before sending.`,
    });
  };

  // Only where the section is written TO the client. When the key is unknown
  // — a caller that has not said which section this is — the check is skipped
  // rather than guessed at, because a false warning is worse than none.
  const ADDRESSES_THE_CLIENT: SectionKey[] = ["introduction", "next_steps"];
  if (sectionKey && ADDRESSES_THE_CLIENT.includes(sectionKey)) {
    check("client_name", intake.client_name, "client name");
  }

  // The company can appear anywhere, but a section that never names it is only
  // worth flagging if it names no party at all — otherwise "your team" and
  // "you" are perfectly good prose in a letter.
  if (sectionKey === "introduction") {
    check("company_name", intake.company_name, "company name");
  }

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

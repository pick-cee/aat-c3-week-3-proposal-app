/**
 * Did the section actually draw on the documents the client sent?
 *
 * The prompt instructs the model to use them. Instruction was not enough —
 * observed twice on real proposals, where four sections were written and none
 * referenced a single attached document. The details a client sends are
 * usually the specifics that make a proposal theirs: system names, volumes,
 * depot counts, the constraints they took the trouble to write down.
 *
 * So this is checked rather than hoped for, in the same shape as the
 * commercial-terms check: measure the output against the input, and act on
 * what is actually there.
 *
 * Pure and dependency-free, so the rule can be tested without a model.
 */

/** Words too common to signal anything about whether a document was read. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "they", "their", "them",
  "have", "has", "had", "are", "was", "were", "will", "would", "can", "could",
  "should", "there", "here", "what", "when", "which", "who", "how", "why",
  "into", "onto", "over", "under", "about", "across", "between", "through",
  "each", "every", "some", "more", "most", "other", "also", "than", "then",
  "our", "your", "his", "her", "its", "not", "but", "all", "any", "one", "two",
  "team", "teams", "system", "systems", "process", "processes", "order",
  "orders", "client", "clients", "customer", "customers", "business",
  "proposal", "project", "work", "time", "need", "needs", "want", "wants",
  "use", "used", "using", "make", "makes", "help", "helps", "provide",
  "provides", "support", "supports", "manage", "manages", "current",
  "currently", "existing", "new", "across", "within", "while", "where",
]);

/**
 * Terms a document contributes that would not appear by chance.
 *
 * Proper nouns and numbers, mainly: "Sage", "WhatsApp", "12 depots". A section
 * containing one of these plausibly read the document; a section containing
 * none of them plausibly did not.
 */
export function distinctiveTerms(text: string): Set<string> {
  const terms = new Set<string>();

  // Capitalised words that are not sentence-initial — product and place names.
  for (const match of text.matchAll(/(?<![.!?]\s|^)\b([A-Z][a-zA-Z]{2,})\b/gm)) {
    const word = match[1]!;
    if (!STOPWORDS.has(word.toLowerCase())) terms.add(word.toLowerCase());
  }

  // Numbers with a unit or a noun after them — "12 depots", "4,200 orders".
  for (const match of text.matchAll(/\b(\d[\d,]*)\s+([a-z]{3,})/gi)) {
    const noun = match[2]!.toLowerCase();
    if (!STOPWORDS.has(noun)) terms.add(`${match[1]!.replace(/,/g, "")} ${noun}`);
  }

  // Bare multi-digit numbers, which in this domain are almost always counts.
  for (const match of text.matchAll(/\b(\d{2,})\b/g)) {
    terms.add(match[1]!);
  }

  return terms;
}

export interface MaterialUseResult {
  /** Terms from the documents that made it into the section. */
  used: string[];
  /** True when the documents contributed nothing identifiable. */
  ignored: boolean;
  /** Shown to the salesperson. Null when there is nothing to say. */
  note: string | null;
}

/**
 * Whether a section drew on the supplied documents.
 *
 * Returns `ignored: false` when there is nothing to check — no documents, or
 * documents with no distinctive terms to look for. Absence of evidence is not
 * evidence here, and a warning fired on a document that simply had no proper
 * nouns would be noise.
 */
export function checkMaterialUse(
  content: string,
  materialSummaries: Array<{ filename: string; summary: string }>,
): MaterialUseResult {
  if (materialSummaries.length === 0) {
    return { used: [], ignored: false, note: null };
  }

  const available = new Set<string>();
  for (const material of materialSummaries) {
    for (const term of distinctiveTerms(material.summary)) available.add(term);
  }

  if (available.size === 0) {
    return { used: [], ignored: false, note: null };
  }

  const haystack = content.toLowerCase();
  const used = [...available].filter((term) => haystack.includes(term));

  if (used.length > 0) {
    return { used, ignored: false, note: null };
  }

  const names = materialSummaries.map((m) => m.filename).join(", ");

  return {
    used: [],
    ignored: true,
    note:
      `This section does not appear to draw on ${names}. The client sent ` +
      `${materialSummaries.length === 1 ? "that document" : "those documents"}` +
      ` — the specifics in ${materialSummaries.length === 1 ? "it" : "them"} ` +
      `are what makes a proposal read as written for them.`,
  };
}

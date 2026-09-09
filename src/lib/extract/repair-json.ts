/**
 * Best-effort repair of a JSON response that carries verbatim quotations.
 *
 * Extraction asks the model to return, for every field, the exact words from
 * the notes that support its answer. Those quotations routinely contain the
 * two things that break JSON:
 *
 *   - raw newlines, because discovery-call notes are multi-line and a quote
 *     often spans lines;
 *   - unescaped double quotes, because a salesperson writing
 *     `stop the "where is my delivery" calls` is quoting the client.
 *
 * The prompt asks the model to escape both and it mostly does. "Mostly" means
 * a salesperson occasionally loses an entire extraction — every field, all
 * eleven — to one piece of punctuation, and is told only that the JSON was
 * malformed.
 *
 * Repairing is safe here because the content is not trusted anyway. Every
 * value still has to survive `verifyProposals`, which checks the quote
 * actually appears in the source text; a repair that produced a plausible but
 * wrong quote would be dropped there. The repair can rescue a valid answer, it
 * cannot manufacture one.
 *
 * Deliberately NOT a regex. Telling a structural quote from one inside a
 * quotation requires knowing whether you are currently inside a string, which
 * means walking the input.
 */
export function repairJson(input: string): string {
  const DQUOTE = String.fromCharCode(34);
  const BACKSLASH = String.fromCharCode(92);
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);

  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    // Whatever follows a backslash is already escaped; pass it through.
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === BACKSLASH) {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === DQUOTE) {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }

      // A genuine closing quote is followed by structure — a comma, a colon,
      // or a closing brace/bracket. Anything else means this quote was part of
      // the quoted text and the model forgot to escape it.
      const followedByStructure = /^\s*[,:}\]]/.test(input.slice(i + 1));

      if (followedByStructure) {
        inString = false;
        out += ch;
      } else {
        out += BACKSLASH + DQUOTE;
      }
      continue;
    }

    // A literal control character inside a string is invalid JSON. The escaped
    // form preserves the text exactly, which matters because this text has to
    // match the source during verification.
    if (inString && (ch === LF || ch === CR || ch === TAB)) {
      out += BACKSLASH + (ch === LF ? "n" : ch === CR ? "r" : "t");
      continue;
    }

    out += ch;
  }

  // Trailing commas before a close: `{"a":1,}` and `[1,2,]`.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

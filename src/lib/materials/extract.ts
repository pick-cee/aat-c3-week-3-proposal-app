import "server-only";

import {
  MAX_EXTRACTED_CHARS_PER_FILE,
  MIN_USEFUL_CHARS,
} from "@/lib/constants";
import type { ExtractionStatus } from "@/lib/db/types";
import { formatNumber } from "@/lib/format";
import { classifyFile, unsupportedReason, type Handling } from "./formats";

export interface ExtractionResult {
  status: ExtractionStatus;
  /** Why, in words. Always set for anything other than a clean `ok`. */
  note: string | null;
  text: string | null;
  /** True when the text was cut short; the note says so too. */
  truncated: boolean;
  /**
   * PDFs and images are not parsed here — they go to Claude as document or
   * image blocks. This says which, so the summarizer knows to attach the bytes.
   */
  passthrough: "document" | "image" | null;
}

export async function extractFile(
  filename: string,
  mimeType: string | null,
  bytes: Uint8Array,
): Promise<ExtractionResult> {
  const handling = classifyFile(filename, mimeType);

  if (handling === "unsupported") {
    return {
      status: "unsupported",
      note: unsupportedReason(filename, mimeType),
      text: null,
      truncated: false,
      passthrough: null,
    };
  }

  // A zero-byte file is empty, not broken. Say which.
  if (bytes.byteLength === 0) {
    return {
      status: "empty",
      note: "This file is empty (0 bytes).",
      text: null,
      truncated: false,
      passthrough: null,
    };
  }

  try {
    return await extractByHandling(handling, filename, bytes);
  } catch (error) {
    // The file exists, is a format we claim to support, and would not parse.
    // Distinct from `unsupported`, and worth the raw reason: a corrupt upload
    // and a password-protected document need different responses from a human.
    return {
      status: "failed",
      note:
        `This file could not be read: ${describeError(error)}. ` +
        `It may be corrupt or password-protected. It was stored but not used ` +
        `in the proposal.`,
      text: null,
      truncated: false,
      passthrough: null,
    };
  }
}

async function extractByHandling(
  handling: Exclude<Handling, "unsupported">,
  filename: string,
  bytes: Uint8Array,
): Promise<ExtractionResult> {
  switch (handling) {
    case "document":
      // Claude reads PDFs natively and far better than a text scraper would —
      // layout, tables and headings survive. The bytes go up as a document
      // block rather than being flattened here.
      return {
        status: "ok",
        note: null,
        text: null,
        truncated: false,
        passthrough: "document",
      };

    case "image":
      return {
        status: "ok",
        note: null,
        text: null,
        truncated: false,
        passthrough: "image",
      };

    case "docx":
      return finish(await extractDocx(bytes), filename);

    case "spreadsheet":
      return finish(extractSpreadsheet(bytes), filename);

    case "text":
      return finish(new TextDecoder("utf-8").decode(bytes), filename);
  }
}

/**
 * Parsers do not always fail fast. Given a file that is not really a .docx,
 * mammoth can sit indefinitely rather than throwing — which in production is an
 * upload that never resolves and a row stuck on `pending` forever. A parse that
 * has not finished in this long is a parse that is not going to.
 */
const PARSE_TIMEOUT_MS = 20_000;

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${label} did not finish within ${PARSE_TIMEOUT_MS / 1000} seconds`,
          ),
        ),
      PARSE_TIMEOUT_MS,
    );
    // Deliberately NOT unref'd. An unref'd timer does not hold the event loop
    // open, so if the hung parse is the only work left the process exits with
    // the promise unsettled instead of rejecting — the caller never gets its
    // error and the material stays `pending`. The `finally` below is what stops
    // this leaking a timer per file.
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    // Clear on the winning path too, or a fast parse still leaves a pending
    // timer behind for every file uploaded.
    if (timer) clearTimeout(timer);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");

  const result = await withTimeout(
    mammoth.extractRawText({ buffer: Buffer.from(bytes) }),
    "Reading this Word document",
  );

  return result.value;
}

function extractSpreadsheet(bytes: Uint8Array): string {
  // Required lazily: `xlsx` is heavy and only some uploads need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");

  const workbook = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];

  // Every sheet, not just the first — the same reason every FILE is processed
  // and not just the first one. A pricing tab hiding behind a cover sheet is
  // exactly the content that matters.
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });

    if (rows.length === 0) continue;

    parts.push(`## ${name}`, "", toMarkdownTable(rows), "");
  }

  return parts.join("\n");
}

function toMarkdownTable(rows: string[][]): string {
  const [header, ...body] = rows;
  if (!header) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_, i) => String(row[i] ?? "").trim());

  const lines = [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ];

  return lines.join("\n");
}

/**
 * Applies the empty threshold and the per-file cap.
 *
 * A file that parses to almost nothing is `empty`, not `ok` — the Week 2 lesson
 * about a successful fetch returning nothing usable. Reporting `ok` with two
 * characters of content would mean the generation silently had nothing to work
 * with while the UI showed a green tick.
 */
function finish(raw: string, filename: string): ExtractionResult {
  const text = raw.trim();

  if (text.length < MIN_USEFUL_CHARS) {
    return {
      status: "empty",
      note:
        text.length === 0
          ? "This file parsed successfully but contained no text."
          : `This file contained only ${text.length} characters of text, too ` +
          `little to be useful. It was read successfully — there is simply ` +
          `almost nothing in it.`,
      text: text.length > 0 ? text : null,
      truncated: false,
      passthrough: null,
    };
  }

  if (text.length > MAX_EXTRACTED_CHARS_PER_FILE) {
    return {
      status: "ok",
      note:
        `Only the first ${formatNumber(MAX_EXTRACTED_CHARS_PER_FILE)} ` +
        `characters of ${filename} were used (of ${formatNumber(text.length)}). ` +
        `The rest was stored but not sent to the model.`,
      text: text.slice(0, MAX_EXTRACTED_CHARS_PER_FILE),
      truncated: true,
      passthrough: null,
    };
  }

  return { status: "ok", note: null, text, truncated: false, passthrough: null };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

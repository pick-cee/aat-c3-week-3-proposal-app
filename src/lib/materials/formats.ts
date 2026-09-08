
export type Handling =
  /** Sent to Claude as a document block. */
  | "document"
  /** Sent to Claude as an image block. */
  | "image"
  /** Parsed server-side with mammoth. */
  | "docx"
  /** Parsed to a markdown table. */
  | "spreadsheet"
  /** Straight through as text. */
  | "text"
  /** We cannot read this. */
  | "unsupported";

interface FormatRule {
  handling: Handling;
  extensions: string[];
  mimeTypes: string[];
  label: string;
}

const RULES: FormatRule[] = [
  {
    handling: "document",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    label: "PDF",
  },
  {
    handling: "image",
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    label: "image",
  },
  {
    handling: "docx",
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    label: "Word document",
  },
  {
    handling: "spreadsheet",
    extensions: [".xlsx", ".xls", ".csv"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ],
    label: "spreadsheet",
  },
  {
    handling: "text",
    extensions: [".txt", ".md", ".markdown"],
    mimeTypes: ["text/plain", "text/markdown"],
    label: "text file",
  },
];

/**
 * The lowercased extension including the dot, or "" if there isn't one.
 *
 * `lastIndexOf(".")` returns -1 for a name with no dot, and `slice(-1)` on that
 * silently returns the LAST CHARACTER — so "Makefile" came back with an
 * extension of "e". A dotfile like ".env" is a name, not an extension, so it
 * reports "" as well.
 */
function extensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return "";
  return lower.slice(dot);
}

/**
 * Extension first, MIME type second.
 *
 * Browsers disagree about MIME types for the formats we care about most —
 * a .csv arrives as `application/vnd.ms-excel` from Excel-owning Windows
 * machines and as `text/csv` elsewhere, and .md is frequently
 * `application/octet-stream`. The extension is what the user actually chose.
 */
export function classifyFile(
  filename: string,
  mimeType?: string | null,
): Handling {
  const extension = extensionOf(filename);

  if (extension) {
    const byExtension = RULES.find((r) => r.extensions.includes(extension));
    if (byExtension) return byExtension.handling;
  }

  if (mimeType) {
    const normalized = mimeType.split(";")[0]!.trim().toLowerCase();
    const byMime = RULES.find((r) => r.mimeTypes.includes(normalized));
    if (byMime) return byMime.handling;

    // A file with no useful extension but a text/* type is still readable.
    if (normalized.startsWith("text/")) return "text";
  }

  return "unsupported";
}

/**
 * Why a file was not read, in words a salesperson can act on.
 *
 * "extraction_status = unsupported" is a state; this is the sentence that goes
 * next to it. A file that silently disappears is the failure DESIGN.md section 7
 * exists to prevent, and a status with no explanation is most of the way there.
 */
export function unsupportedReason(
  filename: string,
  mimeType?: string | null,
): string {
  const extension = extensionOf(filename);

  const KNOWN_BUT_UNREADABLE: Record<string, string> = {
    ".doc": "old Word format — re-save it as .docx and upload again",
    ".pages": "Apple Pages — export it as PDF or .docx",
    ".key": "Keynote — export it as PDF",
    ".numbers": "Apple Numbers — export it as .xlsx or .csv",
    ".zip": "an archive — upload the files inside it individually",
    ".rar": "an archive — upload the files inside it individually",
    ".ppt": "old PowerPoint format — export it as PDF",
    ".pptx": "a PowerPoint deck — export it as PDF and upload that",
    ".mp4": "a video",
    ".mov": "a video",
    ".mp3": "an audio file",
    ".wav": "an audio file",
  };

  const known = KNOWN_BUT_UNREADABLE[extension];
  if (known) {
    return `This is ${known}. It was stored but not used in the proposal.`;
  }

  const shown = extension ? `"${extension}" files` : "files with no extension";
  return (
    `${shown} cannot be read${mimeType ? ` (${mimeType})` : ""}. ` +
    `Supported: PDF, images, .docx, .xlsx, .csv, .txt and .md. ` +
    `It was stored but not used in the proposal.`
  );
}

/** The `accept` attribute for the upload input. Same rules, stated to the browser. */
export const ACCEPTED_FILE_TYPES = RULES.flatMap((r) => r.extensions).join(",");

/** Human-readable list, for the hint under the upload control. */
export const SUPPORTED_FORMATS_LABEL =
  "PDF, images, Word, Excel, CSV, and plain text";

import type { ReactNode } from "react";

import { TO_BE_CONFIRMED } from "@/lib/constants";
import { cn } from "@/components/ui/primitives";

/**
 * Renders section content.
 *
 * Sections carry light markdown — bullet lists from the deliverables prompt,
 * and the emphasis the template renderer puts on a price or a timeline. Every
 * screen previously showed this with `whitespace-pre-wrap`, which meant a
 * client would have read literal asterisks around the number.
 *
 * A hand-rolled renderer rather than a markdown library: the surface is
 * paragraphs, bullets, and bold, and pulling in a parser to handle three
 * constructs would bring an HTML sanitiser problem with it. Nothing here can
 * emit markup — every branch produces React elements from text.
 */
export function ProposalProse({
  content,
  className,
  tone = "muted",
}: {
  content: string;
  className?: string;
  /** `document` for client-facing pages, where the text is the whole point. */
  tone?: "muted" | "document";
}) {
  const blocks = content.trim().split(/\n{2,}/);

  return (
    <div
      className={cn(
        "prose-proposal",
        tone === "muted" ? "text-ink-muted" : "text-ink",
        className,
      )}
    >
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^[-•*]\s/.test(l));

        if (isList) {
          return (
            <ul key={i}>
              {lines.map((line, j) => (
                <li key={j}>{inline(line.replace(/^[-•*]\s*/, ""))}</li>
              ))}
            </ul>
          );
        }

        return <p key={i}>{inline(block)}</p>;
      })}
    </div>
  );
}

/**
 * Bold spans, and the missing-value marker.
 *
 * `[To be confirmed]` is styled distinctly wherever it appears — DESIGN.md
 * section 9 asks for it to be obvious in a client-facing document, and a
 * placeholder that blends into the prose is one that reaches a client
 * unnoticed.
 */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and the marker, keeping the delimiters.
  const pattern = new RegExp(
    `(\\*\\*[^*]+\\*\\*|${TO_BE_CONFIRMED.replace(/[[\]]/g, "\\$&")})`,
    "g",
  );

  const parts = text.split(pattern).filter((p) => p !== "");

  for (const [i, part] of parts.entries()) {
    if (part === TO_BE_CONFIRMED) {
      nodes.push(
        <mark
          key={i}
          className="rounded bg-state-review-fill px-1 py-0.5 font-medium text-[hsl(32_81%_29%)]"
        >
          {part}
        </mark>,
      );
      continue;
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>,
      );
      continue;
    }

    nodes.push(part);
  }

  return nodes;
}

import { TO_BE_CONFIRMED } from "@/lib/constants";
import type { Proposal } from "@/lib/db/types";


export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

export function composeClientEmail(
  proposal: Proposal,
  proposalUrl: string,
): ComposedEmail {
  const company = proposal.company_name?.trim() || "your team";
  const client = proposal.client_name?.trim();
  const salesperson = proposal.salesperson_name?.trim() || proposal.author_name;

  // "Hi there" rather than "Hi [To be confirmed]" or "Hi ,". A missing name is
  // handled by writing around it, exactly as the proposal body does.
  const greeting = client ? `Hi ${client},` : "Hi there,";

  const subject =
    proposal.version > 1
      ? `Updated proposal for ${company}`
      : `Proposal for ${company}`;

  const lines = [
    greeting,
    "",
    "Thanks again for taking the time to speak with us. Based on our " +
    "conversation, we have put together a customized proposal for your review.",
    "",
    proposal.version > 1
      ? "This replaces the version we sent previously."
      : null,
    proposal.version > 1 ? "" : null,
    "You can view the proposal here:",
    proposalUrl,
    "",
    "This document outlines the project scope, timeline, pricing details, and " +
    "recommended approach.",
    "",
    "If you have any questions or would like to make adjustments, feel free to " +
    "reach out. We are happy to iterate with you.",
    "",
    "Looking forward to hearing your thoughts.",
    "",
    "Best regards,",
    salesperson,
    "Koya Talent",
  ].filter((line): line is string => line !== null);

  return {
    subject,
    text: lines.join("\n"),
    html: renderHtml({ greeting, proposal, proposalUrl, salesperson }),
  };
}

function renderHtml({
  greeting,
  proposal,
  proposalUrl,
  salesperson,
}: {
  greeting: string;
  proposal: Proposal;
  proposalUrl: string;
  salesperson: string;
}): string {
  const superseded =
    proposal.version > 1
      ? `<p style="margin:0 0 16px">This replaces the version we sent previously.</p>`
      : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px">
      <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 16px">
        Thanks again for taking the time to speak with us. Based on our
        conversation, we have put together a customized proposal for your review.
      </p>
      ${superseded}
      <p style="margin:24px 0">
        <a href="${escapeHtml(proposalUrl)}"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:500">
          View the proposal
        </a>
      </p>
      <p style="margin:0 0 16px">
        This document outlines the project scope, timeline, pricing details, and
        recommended approach.
      </p>
      <p style="margin:0 0 16px">
        If you have any questions or would like to make adjustments, feel free to
        reach out. We are happy to iterate with you.
      </p>
      <p style="margin:0 0 4px">Best regards,</p>
      <p style="margin:0;font-weight:500">${escapeHtml(salesperson)}</p>
      <p style="margin:0;color:#64748b">Koya Talent</p>
    </div>
  </body>
</html>`;
}

/**
 * Intake values reach the client, and they are typed by a human. An apostrophe
 * in a company name should not be able to break the markup, let alone inject
 * into it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function demoNotice(intended: string, actual: string): string {
  return (
    `Demo mode: this will be sent to ${actual}, not to ${intended}. ` +
    `The proposal records ${intended} as the intended recipient.`
  );
}

/** True when the proposal would go out with a placeholder still in it. */
export function hasUnresolvedPlaceholders(sections: Array<{ content: string | null }>) {
  return sections.some((s) => (s.content ?? "").includes(TO_BE_CONFIRMED));
}

// --- Enumerations ----------------------------------------------------------

/** No `send_failed`: delivery state is derived from `deliveries`. */
export const PROPOSAL_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "sent",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const SECTION_KEYS = [
  "introduction",
  "solution",
  "deliverables",
  "timeline",
  "pricing",
  "next_steps",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionSource = "generated" | "template";

export type ExtractionStatus =
  | "pending"
  | "ok"
  | "unsupported"
  | "failed"
  | "empty";

export type ActivityEvent =
  | "created"
  | "intake_extracted"
  | "intake_confirmed"
  | "generated"
  | "generation_rejected"
  | "generation_failed"
  | "regenerated"
  | "material_summarized"
  | "intake_edited"
  | "sections_marked_stale"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "version_forked"
  | "sent"
  | "send_failed"
  | "rate_limited";

export type UserRole = "salesperson" | "approver";

// --- Intake ----------------------------------------------------------------

/**
 * The intake fields, as one shape. Used for the row, for the `generated_from`
 * snapshot, and for the drift diff — the three have to agree, so they share a
 * type.
 */
export interface IntakeFields {
  client_name: string | null;
  client_email: string | null;
  company_name: string | null;
  date_of_call: string | null;
  salesperson_name: string | null;
  client_needs_summary: string | null;
  project_scope: string | null;
  goals_and_objectives: string | null;
  recommended_services: string | null;
  proposed_timeline: string | null;
  estimated_pricing: string | null;
}

export const INTAKE_FIELD_KEYS = [
  "client_name",
  "client_email",
  "company_name",
  "date_of_call",
  "salesperson_name",
  "client_needs_summary",
  "project_scope",
  "goals_and_objectives",
  "recommended_services",
  "proposed_timeline",
  "estimated_pricing",
] as const satisfies readonly (keyof IntakeFields)[];

/** Human-readable labels. Used in gap notices and staleness markers. */
export const INTAKE_FIELD_LABELS: Record<keyof IntakeFields, string> = {
  client_name: "Client Name",
  client_email: "Client Email",
  company_name: "Company Name",
  date_of_call: "Date of Call",
  salesperson_name: "Salesperson Name",
  client_needs_summary: "Summary of Client's Needs",
  project_scope: "Project Scope",
  goals_and_objectives: "Goals and Objectives",
  recommended_services: "Recommended Services",
  proposed_timeline: "Proposed Timeline",
  estimated_pricing: "Estimated Pricing",
};

// --- jsonb payloads --------------------------------------------------------

export type FieldTier = "block" | "warn" | "mark";

export interface FieldGap {
  field: keyof IntakeFields;
  tier: FieldTier;
  treatment: string;
}

/**
 * Why a section may no longer match what it was built on. Tagged because the
 * causes are different — an edited intake field, an earlier section being
 * regenerated, or a document arriving after the writing was done — but the UI
 * treats them identically.
 *
 * `material` carries the filename rather than an id: the marker has to stay
 * readable after the file itself is deleted, and "written before Northwind
 * RFP.pdf was uploaded" is the sentence a salesperson can act on.
 */
export type StaleReason =
  | { kind: "intake"; field: keyof IntakeFields }
  | { kind: "section"; section_key: SectionKey }
  | { kind: "material"; filename: string };

// --- Rows ------------------------------------------------------------------

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

/**
 * Where an intake value came from, when extraction proposed it.
 *
 * A field absent from the map was typed by hand — and an edited field is
 * removed, because a source phrase that no longer supports the value would
 * lend false confidence to a number nobody extracted.
 */
export interface FieldProvenance {
  /** The verified span of the notes or a material summary. */
  source: string;
  /** True once a human accepted it on the confirm screen. */
  confirmed: boolean;
  /**
   * Set only when the field was left EMPTY because the source touched it
   * without settling it — "Call 14 Oct" with no year. Names what was missing.
   *
   * Its presence is what distinguishes the two kinds of entry: with a reason
   * the field is empty and this explains why; without one the field is filled
   * and this is the evidence. An empty field with no entry at all means the
   * notes never mentioned it, which needs no explanation.
   */
  reason?: string;
}

export interface Proposal extends IntakeFields {
  id: string;
  version: number;
  parent_id: string | null;
  status: ProposalStatus;
  author_id: string;
  author_name: string;
  field_gaps: FieldGap[];
  /** Discovery-call notes as typed. Input to extraction only. */
  raw_notes: string | null;
  field_provenance: Partial<Record<keyof IntakeFields, FieldProvenance>>;
  share_token: string;
  created_at: string;
  updated_at: string;
}

export interface ProposalSection {
  id: string;
  proposal_id: string;
  section_key: SectionKey;
  title: string;
  position: number;
  source: SectionSource;
  content: string | null;
  generated_from: IntakeFields | null;
  model_used: string | null;
  input_tokens: number;
  output_tokens: number;
  regenerated_count: number;
  edited_by_human: boolean;
  last_generated_at: string | null;
  stale_fields: StaleReason[];
}

export interface SupportingMaterial {
  id: string;
  proposal_id: string;
  filename: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  extraction_status: ExtractionStatus;
  extraction_note: string | null;
  extracted_text: string | null;
  summary: string | null;
  summarized: boolean;
  created_at: string;
}

export interface Approval {
  id: string;
  proposal_id: string;
  approver_id: string;
  approver_name: string;
  decision: "approved" | "changes_requested";
  /** Anything not about a specific section. */
  note: string | null;
  created_at: string;
}

/**
 * A note about ONE section, attached to one decision.
 *
 * The approver knows which section they object to at the moment they object to
 * it. Making them describe the location in prose — and the salesperson find it
 * again by reading — is work the interface can simply do.
 */
export interface ApprovalComment {
  id: string;
  approval_id: string;
  section_key: SectionKey;
  note: string;
  created_at: string;
}

export interface Delivery {
  id: string;
  proposal_id: string;
  intended_recipient: string;
  actual_recipient: string;
  demo_mode: boolean;
  status: "sent" | "failed";
  provider_message_id: string | null;
  error: string | null;
  failure_reason: string | null;
  retryable: boolean | null;
  attempt: number;
  created_at: string;
}

export interface ActivityLogEntry {
  id: number;
  proposal_id: string | null;
  actor_name: string | null;
  event: ActivityEvent;
  detail: string | null;
  model_used: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

/** What `get_shared_proposal` returns. Deliberately narrow — see migration 0003. */
export interface SharedProposal {
  client_name: string | null;
  company_name: string | null;
  salesperson_name: string | null;
  date_of_call: string | null;
  version: number;
  is_superseded: boolean;
  first_sent_at: string | null;
  updated_at: string;
  sections: Array<{
    title: string;
    content: string | null;
    position: number;
  }>;
}

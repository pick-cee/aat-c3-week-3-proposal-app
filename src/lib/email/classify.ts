export type FailureKind =
  | "invalid_recipient"
  | "domain_not_verified"
  | "rate_limited"
  | "auth"
  | "provider_unreachable"
  | "unknown";

export interface ClassifiedFailure {
  kind: FailureKind;
  /** Plain language, shown to the user. Says what happened and what to do. */
  reason: string;
  /** False for config problems a retry cannot fix. */
  retryable: boolean;
}

/**
 * Matched on message text as well as status code, because providers are not
 * consistent about which they use. Order matters: the specific patterns are
 * tried before the general ones.
 */
const PATTERNS: Array<{
  kind: FailureKind;
  test: (message: string, status?: number) => boolean;
  reason: string;
  retryable: boolean;
}> = [
    {
      kind: "domain_not_verified",
      test: (m) =>
        /domain is not verified|not verified|verify a domain|domain_not_verified/i.test(
          m,
        ),
      reason:
        "The sending domain is not verified with the email provider. " +
        "This needs an administrator — retrying will fail the same way.",
      retryable: false,
    },
    {
      kind: "auth",
      test: (m, status) =>
        status === 401 ||
        status === 403 ||
        /api key|unauthori[sz]ed|forbidden|invalid_access|missing_api_key/i.test(m),
      reason:
        "Email is not configured correctly on the server — the API key is " +
        "missing, invalid, or lacks permission. This needs an administrator.",
      retryable: false,
    },
    {
      kind: "invalid_recipient",
      test: (m, status) =>
        status === 422 ||
        /invalid.*(email|recipient|address)|recipient.*(invalid|rejected)|not a valid email|invalid_parameter.*to/i.test(
          m,
        ),
      reason:
        "The client's email address was rejected as invalid. " +
        "Check it on the intake form, correct it, and try again.",
      // Retryable only after the address is fixed — which is what the message
      // asks for. Offering the button lets them retry once they have.
      retryable: true,
    },
    {
      kind: "rate_limited",
      test: (m, status) =>
        status === 429 || /rate.?limit|too many requests|throttl/i.test(m),
      reason:
        "The email provider is throttling us. Wait a minute and try again.",
      retryable: true,
    },
    {
      kind: "provider_unreachable",
      test: (m, status) =>
        (status !== undefined && status >= 500) ||
        // Node's connection errnos (ETIMEDOUT, ECONNRESET, EAI_AGAIN…) are what
        // actually arrive when the network fails — matching only on the English
        // words "timeout" and "network" misses every one of them.
        /\bE(TIMEDOUT|CONNREFUSED|CONNRESET|HOSTUNREACH|NETUNREACH|NOTFOUND|PIPE|AI_AGAIN)\b/i.test(
          m,
        ) ||
        /timeout|timed out|socket hang up|network|fetch failed|unavailable|bad gateway/i.test(
          m,
        ),
      reason:
        "The email service could not be reached. This is usually temporary — " +
        "try again in a moment.",
      retryable: true,
    },
  ];

export function classifySendFailure(error: unknown): ClassifiedFailure {
  const message = messageOf(error);
  const status = statusOf(error);

  for (const pattern of PATTERNS) {
    if (pattern.test(message, status)) {
      return {
        kind: pattern.kind,
        reason: pattern.reason,
        retryable: pattern.retryable,
      };
    }
  }

  return {
    kind: "unknown",
    reason:
      "The send failed with an unexpected error. The details are recorded " +
      "below — contact whoever maintains this application.",
    // Retryable by default: an unrecognised error is more often transient than
    // permanent, and refusing to offer a retry on something that might work is
    // the worse mistake when a client is waiting.
    retryable: true,
  };
}

/** The raw provider error, kept verbatim for debugging. */
export function rawErrorText(error: unknown): string {
  if (error === null || error === undefined) return "No error detail.";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    // Resend returns { name, message } rather than throwing.
    const parts = [record.message, record.name, record.error, record.code]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (parts) return parts;

    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }

  return String(error ?? "");
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["statusCode", "status", "code"]) {
      const value = record[key];
      if (typeof value === "number") return value;
    }
  }
  return undefined;
}

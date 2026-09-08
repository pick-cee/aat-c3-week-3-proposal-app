import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** Token usage from a call, in the shape the activity log and sections store. */
export interface Usage {
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Every model failure this application distinguishes.
 *
 * Classified because DESIGN.md section 10 requires a plain-language cause and a
 * retry button only where retrying could help. An overloaded API is worth
 * another attempt; a malformed request is not, and offering the button teaches
 * people to distrust it.
 */
export type ModelFailureKind =
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "auth"
  | "invalid_request"
  | "unknown";

export class ModelCallError extends Error {
  constructor(
    readonly kind: ModelFailureKind,
    /** Shown to the user. Says what happened and whether to try again. */
    message: string,
    /** Whether a retry could plausibly succeed. */
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

export function classifyModelError(error: unknown): ModelCallError {
  if (error instanceof ModelCallError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    return new ModelCallError(
      "rate_limited",
      "Claude is rate limiting us. Wait a moment and try again.",
      true,
      error,
    );
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return new ModelCallError(
      "auth",
      "The Anthropic API key is missing or invalid. This needs an administrator, not a retry.",
      false,
      error,
    );
  }

  if (error instanceof Anthropic.BadRequestError) {
    return new ModelCallError(
      "invalid_request",
      "Claude rejected the request. This is a bug in the application rather than " +
      "something a retry will fix.",
      false,
      error,
    );
  }

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelCallError(
      "timeout",
      "The request to Claude timed out. This is usually temporary — try again.",
      true,
      error,
    );
  }

  if (error instanceof Anthropic.APIError) {
    // 5xx and overloaded are worth retrying; other statuses generally are not.
    const retryable = error.status === undefined || error.status >= 500;
    return new ModelCallError(
      retryable ? "overloaded" : "unknown",
      retryable
        ? "Claude could not be reached. This is usually temporary — try again."
        : `Claude returned an unexpected error (${error.status}).`,
      retryable,
      error,
    );
  }

  return new ModelCallError(
    "unknown",
    "Something went wrong talking to Claude. The details are in the activity log.",
    true,
    error,
  );
}

/** Pulls the plain text out of a response, ignoring thinking blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function usageOf(message: Anthropic.Message): Usage {
  return {
    modelUsed: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

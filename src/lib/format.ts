
const LOCALE = "en-GB";

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const DATE_SHORT = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_ONLY = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const NUMBER = new Intl.NumberFormat(LOCALE);

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "9 Sep, 10:03" — for activity rows and section metadata. */
export function formatDateTime(value: string | Date): string {
  return DATE_TIME.format(toDate(value));
}

/** "9 September 2026" — for the client-facing document. */
export function formatDateLong(value: string | Date): string {
  return DATE_ONLY.format(toDate(value));
}

/** "9 Sep 2026" — where the year matters but space is tight. */
export function formatDateShort(value: string | Date): string {
  return DATE_SHORT.format(toDate(value));
}

/** "10:03" — for a rate-limit reset, where the date is today by definition. */
export function formatTime(value: string | Date): string {
  return TIME_ONLY.format(toDate(value));
}

/** Thousands separators, consistently on both sides of the render. */
export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

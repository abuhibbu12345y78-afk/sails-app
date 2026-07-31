export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Kolkata";

export interface TrustedTimeSnapshot {
  serverTime: string;
  businessDate: string;
  timezone: string;
}

export interface BusinessTimeService {
  getCurrentServerTime(): Promise<Date>;
  getCurrentBusinessDate(): Promise<string>;
  getSnapshot(): Promise<TrustedTimeSnapshot>;
  formatBusinessDate(date: Date): string;
  formatBusinessTime(date: Date, includeSeconds?: boolean): string;
}

export function toBusinessDate(date: Date, timezone = DEFAULT_BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatBusinessDate(date: Date, timezone = DEFAULT_BUSINESS_TIMEZONE, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatBusinessTime(
  date: Date,
  timezone = DEFAULT_BUSINESS_TIMEZONE,
  locale = "en-IN",
  includeSeconds = true,
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: true,
  }).format(date);
}

export function calculateServerOffset(serverTime: Date, deviceTime: Date) {
  return serverTime.getTime() - deviceTime.getTime();
}

export function trustedNow(deviceTime: Date, offsetMs: number) {
  return new Date(deviceTime.getTime() + offsetMs);
}

export function formatWorkingDuration(startedAt: Date, currentTime: Date) {
  const totalMinutes = Math.max(0, Math.floor((currentTime.getTime() - startedAt.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

import {
  type BusinessTimeService,
  type TrustedTimeSnapshot,
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDate,
  formatBusinessTime,
} from "../../domain/business-time";

export class HttpBusinessTimeService implements BusinessTimeService {
  constructor(
    private readonly timezone = DEFAULT_BUSINESS_TIMEZONE,
    private readonly locale = "en-IN",
  ) {}

  async getSnapshot(): Promise<TrustedTimeSnapshot> {
    const response = await fetch("/api/time", { cache: "no-store" });
    const result = await response.json() as TrustedTimeSnapshot & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Trusted time is unavailable.");
    return result;
  }

  async getCurrentServerTime() {
    return new Date((await this.getSnapshot()).serverTime);
  }

  async getCurrentBusinessDate() {
    return (await this.getSnapshot()).businessDate;
  }

  formatBusinessDate(date: Date) {
    return formatBusinessDate(date, this.timezone, this.locale);
  }

  formatBusinessTime(date: Date, includeSeconds = true) {
    return formatBusinessTime(date, this.timezone, this.locale, includeSeconds);
  }
}

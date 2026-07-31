export type UnsubscribeFunction = () => void;

export interface RealtimeService {
  subscribeToSales(onChange: () => void): UnsubscribeFunction;
  subscribeToProductProgress(onChange: () => void): UnsubscribeFunction;
  subscribeToFullCommissions(onChange: () => void): UnsubscribeFunction;
  subscribeToDayClosures(onChange: () => void): UnsubscribeFunction;
}

/**
 * Provider-neutral fallback used when a push provider is unavailable.
 * The Supabase implementation can replace this without changing UI code.
 */
export class PollingRealtimeService implements RealtimeService {
  constructor(private readonly intervalMs = 30_000) {}
  private subscribe(onChange: () => void) {
    const timer = setInterval(onChange, this.intervalMs);
    return () => clearInterval(timer);
  }
  subscribeToSales = (onChange: () => void) => this.subscribe(onChange);
  subscribeToProductProgress = (onChange: () => void) => this.subscribe(onChange);
  subscribeToFullCommissions = (onChange: () => void) => this.subscribe(onChange);
  subscribeToDayClosures = (onChange: () => void) => this.subscribe(onChange);
}

import type { AppSettings, DaySession, FullCommissionReward, SaleRecord, TrackerState } from "../application/contracts";
import type { Product } from "../domain/products";

export interface ProductRepository { listActive(): Promise<Product[]>; }
export interface SaleRepository {
  create(productId: string, quantity: number, idempotencyKey: string): Promise<SaleRecord>;
  listRecent(limit: number, cursor?: string): Promise<SaleRecord[]>;
}
export interface CommissionRepository { listFullCommissions(limit: number): Promise<FullCommissionReward[]>; }
export interface CommissionProgressRepository { listProgress(): Promise<Product[]>; }
export interface DaySessionRepository {
  start(items: Array<{ productId: string; pickedQuantity: number }>): Promise<DaySession>;
  getCurrent(): Promise<DaySession | null>;
  reopen(sessionId: string, reason: string): Promise<DaySession>;
  addPickup(sessionId: string, reason: string, items: Array<{ productId: string; additionalQuantity: number }>): Promise<DaySession>;
}
export interface DayCloseRepository {
  preview(sessionId: string): Promise<DaySession>;
  closeOpenDay(sessionId: string): Promise<{ reportText: string; closedAt: string; closureVersion: number }>;
}
export interface SettingsRepository { get(): Promise<AppSettings>; update(input: AppSettings): Promise<void>; }
export interface AuditLogRepository { record(action: string, entityType: string, entityId: string, metadata?: object): Promise<void>; }
export interface TrackerRepository { getState(): Promise<TrackerState>; }

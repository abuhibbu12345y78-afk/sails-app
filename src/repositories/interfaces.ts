import type { AppSettings, FullCommissionReward, SaleRecord, TrackerState } from "../application/contracts";
import type { Product } from "../domain/products";

export interface ProductRepository { listActive(): Promise<Product[]>; }
export interface SaleRepository {
  create(productId: string, quantity: number, idempotencyKey: string): Promise<SaleRecord>;
  listRecent(limit: number, cursor?: string): Promise<SaleRecord[]>;
}
export interface CommissionRepository { listFullCommissions(limit: number): Promise<FullCommissionReward[]>; }
export interface CommissionProgressRepository { listProgress(): Promise<Product[]>; }
export interface DayCloseRepository { closeToday(): Promise<{ reportText: string }>; }
export interface SettingsRepository { get(): Promise<AppSettings>; update(input: AppSettings): Promise<void>; }
export interface AuditLogRepository { record(action: string, entityType: string, entityId: string, metadata?: object): Promise<void>; }
export interface TrackerRepository { getState(): Promise<TrackerState>; }

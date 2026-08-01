import type { CommissionCalculationResult } from "../domain/commission";
import type { Product } from "../domain/products";

export interface SaleRecord extends CommissionCalculationResult {
  id: string;
  productId: string;
  productName: string;
  unitPricePaise: number;
  normalCommissionPaise: number;
  fullCommissionPaise: number;
  rewardThreshold: number;
  businessDate?: string;
  createdAt: string;
}

export interface DashboardSummary {
  totalUnits: number;
  grossSalesPaise: number;
  totalNormalCommissionPaise: number;
  totalFullCommissionPaise: number;
  totalEarningsPaise: number;
  totalExpensesPaise: number;
  netCollectionPaise: number;
}

export interface FullCommissionReward {
  id: string;
  saleId: string;
  productName: string;
  cycleNumber: number;
  amountPaise: number;
  status: 'EARNED' | 'RECEIVED';
  createdAt: string;
}

export interface AppSettings {
  salesmanName: string;
  businessName: string;
  whatsappNumber: string;
  currency: string;
  locale: string;
  timezone: string;
  realtimeEnabled: boolean;
}

export interface DayStockItem {
  id: string;
  productId: string;
  productName: string;
  unitPricePaise: number;
  pickedQuantity: number;
  soldQuantity: number;
  remainingQuantity: number;
}

export interface DayExpense {
  id: string;
  daySessionId: string;
  category: "Petrol" | "Food" | "Other";
  amountPaise: number;
  createdAt: string;
}

export interface DaySession {
  id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
  startedAt: string;
  closedAt: string | null;
  reopenCount: number;
  stockItems: DayStockItem[];
  expenses: DayExpense[];
}

export type DaySessionStatus = "NOT_STARTED" | "OPEN" | "PREVIOUS_DAY_STILL_OPEN" | "CLOSED";
export type OpeningState = "NEW_DAY" | "CURRENT_OPEN" | "CURRENT_CLOSED" | "PREVIOUS_OPEN";

export interface DayCloseSnapshot {
  id: string;
  businessDate: string;
  closureVersion: number;
  status: "ACTIVE" | "SUPERSEDED";
  reportText: string;
  whatsappReportStatus: "CURRENT" | "OUTDATED";
  createdAt: string;
}

export interface ReopenEligibility {
  allowed: boolean;
  reason: string | null;
}

export interface TrustedTimeState {
  serverTime: string;
  businessDate: string;
  timezone: string;
}

export interface TrackerState {
  products: Product[];
  dashboard: DashboardSummary;
  sales: SaleRecord[];
  rewards: FullCommissionReward[];
  settings: AppSettings;
  isDayClosed: boolean;
  time: TrustedTimeState;
  daySession: DaySession | null;
  daySessionStatus: DaySessionStatus;
  openingState: OpeningState;
  dayCloseSnapshot: DayCloseSnapshot | null;
  reopenEligibility: ReopenEligibility;
  resetEligibility: ReopenEligibility;
  historySales: SaleRecord[];
  expenses: DayExpense[];
  lastUpdatedAt: string;
}

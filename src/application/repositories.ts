import type { AppSettings, DaySession, DayStockItem, TrackerState, TrustedTimeState, DayExpense } from "./contracts";
import type { CommissionCalculationResult } from "../domain/commission";

export interface StartDayInput {
  items: Array<{
    productId: string;
    pickedQuantity: number;
  }>;
}

export interface StartDayResult {
  id: string;
  businessDate: string;
  startedAt: string;
}

export interface CloseDayResult {
  id: string;
  reportText: string;
  whatsappNumber: string;
  closedAt: string;
  businessDate: string;
  closureVersion: number;
}

export interface ReopenDayInput {
  sessionId: string;
  reason: string;
}

export interface ReopenDayResult {
  sessionId: string;
  reopenCount: number;
  reopenedAt: string;
}

export interface AdditionalPickupInput {
  sessionId: string;
  reason: string;
  items: Array<{
    productId: string;
    additionalQuantity: number;
  }>;
}

export interface AdditionalPickupPreviewItem {
  productId: string;
  additionalQuantity: number;
  previousPickedQuantity: number;
  previousRemainingQuantity: number;
  newPickedQuantity: number;
  newRemainingQuantity: number;
}

export interface AdditionalPickupResult {
  sessionId: string;
  totalAdditionalUnits: number;
  items: AdditionalPickupPreviewItem[];
  createdAt: string;
}

export interface HistoricalDataInput {
  businessDate: string;
  pickupItems: Array<{
    productId: string;
    pickedQuantity: number;
  }>;
  salesItems: Array<{
    productId: string;
    quantity: number;
  }>;
}

export interface HistoricalDataResult {
  sessionId: string;
}

export interface DaySessionRepository {
  startDaySession(input: StartDayInput): Promise<StartDayResult>;
  closeDaySession(sessionId: string): Promise<CloseDayResult>;
  reopenDaySession(input: ReopenDayInput): Promise<ReopenDayResult>;
  additionalPickup(input: AdditionalPickupInput): Promise<AdditionalPickupResult>;
  submitHistoricalData(input: HistoricalDataInput): Promise<HistoricalDataResult>;
  resetBusinessDay(sessionId: string): Promise<void>;
}

export interface CreateSaleInput {
  productId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface CreateSaleResult {
  saleId: string;
  duplicate: boolean;
  calculation?: CommissionCalculationResult;
}

export interface SaleRepository {
  createSale(input: CreateSaleInput): Promise<CreateSaleResult>;
  markOfferReceived(rewardId: string): Promise<void>;
  undoOfferReceived(rewardId: string): Promise<void>;
}

export interface SettingsRepository {
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<void>;
}

import type { DateFilterOptions } from "./contracts";

export interface StateRepository {
  getTrackerState(filter?: DateFilterOptions): Promise<TrackerState>;
  getTrustedTime(): Promise<TrustedTimeState>;
}

export interface CreateExpenseInput {
  sessionId: string;
  category: "Petrol" | "Food" | "Other";
  amountPaise: number;
  description?: string;
}

export interface ExpenseRepository {
  addExpense(input: CreateExpenseInput): Promise<DayExpense>;
  updateExpense(expenseId: string, input: { amountPaise?: number; description?: string }): Promise<DayExpense>;
  deleteExpense(expenseId: string): Promise<void>;
  getExpenses(sessionId: string): Promise<DayExpense[]>;
}

export interface DatabaseProvider {
  daySession: DaySessionRepository;
  sale: SaleRepository;
  settings: SettingsRepository;
  state: StateRepository;
  expense: ExpenseRepository;
}

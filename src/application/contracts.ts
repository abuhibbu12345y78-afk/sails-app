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
  createdAt: string;
}

export interface DashboardSummary {
  totalUnits: number;
  grossSalesPaise: number;
  totalNormalCommissionPaise: number;
  totalFullCommissionPaise: number;
  totalEarningsPaise: number;
  netCollectionPaise: number;
}

export interface FullCommissionReward {
  id: string;
  saleId: string;
  productName: string;
  cycleNumber: number;
  amountPaise: number;
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

export interface TrackerState {
  products: Product[];
  dashboard: DashboardSummary;
  sales: SaleRecord[];
  rewards: FullCommissionReward[];
  settings: AppSettings;
  isDayClosed: boolean;
}

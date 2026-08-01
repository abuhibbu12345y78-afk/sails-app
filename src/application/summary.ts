import type { DashboardSummary, SaleRecord } from "./contracts";

export function summarizeSales(sales: SaleRecord[]): DashboardSummary {
  return sales.reduce<DashboardSummary>((total, sale) => ({
    totalUnits: total.totalUnits + sale.quantity,
    grossSalesPaise: total.grossSalesPaise + sale.grossSalesPaise,
    totalNormalCommissionPaise: total.totalNormalCommissionPaise + sale.totalNormalCommissionPaise,
    totalFullCommissionPaise: total.totalFullCommissionPaise + sale.totalFullCommissionPaise,
    totalEarningsPaise: total.totalEarningsPaise + sale.totalEarningsPaise,
    netCollectionPaise: total.netCollectionPaise + sale.netCollectionPaise,
    totalExpensesPaise: total.totalExpensesPaise,
  }), {
    totalUnits: 0,
    grossSalesPaise: 0,
    totalNormalCommissionPaise: 0,
    totalFullCommissionPaise: 0,
    totalEarningsPaise: 0,
    netCollectionPaise: 0,
    totalExpensesPaise: 0,
  });
}

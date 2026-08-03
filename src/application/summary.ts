import type { DashboardSummary, SaleRecord } from "./contracts";

export function summarizeSales(sales: SaleRecord[], expensesPaise = 0): DashboardSummary {
  const summary = sales.reduce<DashboardSummary>((total, sale) => ({
    totalUnits: total.totalUnits + (sale.quantity - sale.returnedQuantity),
    grossSalesPaise: total.grossSalesPaise + sale.grossSalesPaise,
    totalNormalCommissionPaise: total.totalNormalCommissionPaise + sale.totalNormalCommissionPaise,
    totalFullCommissionPaise: total.totalFullCommissionPaise + sale.totalFullCommissionPaise,
    totalEarningsPaise: total.totalEarningsPaise + sale.totalEarningsPaise,
    netCollectionPaise: total.netCollectionPaise + sale.netCollectionPaise,
    totalExpensesPaise: 0,
  }), {
    totalUnits: 0,
    grossSalesPaise: 0,
    totalNormalCommissionPaise: 0,
    totalFullCommissionPaise: 0,
    totalEarningsPaise: 0,
    netCollectionPaise: 0,
    totalExpensesPaise: 0,
  });
  summary.totalExpensesPaise = expensesPaise;
  summary.netCollectionPaise = summary.netCollectionPaise - expensesPaise;
  return summary;
}

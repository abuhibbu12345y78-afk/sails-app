import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeSales } from "../src/application/summary.ts";
import type { SaleRecord } from "../src/application/contracts.ts";

describe("Expense and Settlement Calculations", () => {
  it("Test A — Basic Expense Calculation", () => {
    // Gross Sales: ₹10,000 (1_000_000 paise), Commission: ₹1,000 (100_000 paise), Expenses: ₹600 (60_000 paise)
    const sales: SaleRecord[] = [{
      id: "s1",
      productId: "p1",
      productName: "Item",
      unitPricePaise: 1000000,
      normalCommissionPaise: 100000,
      fullCommissionPaise: 0,
      rewardThreshold: 12,
      quantity: 1,
      normalUnits: 1,
      fullUnits: 0,
      grossSalesPaise: 1000000,
      totalNormalCommissionPaise: 100000,
      totalFullCommissionPaise: 0,
      totalEarningsPaise: 100000,
      netCollectionPaise: 900000,
      finalProgress: 1,
      finalCycle: 1,
      fullCommissionCycles: [],
      returnedQuantity: 0,
      createdAt: new Date().toISOString(),
    }];

    const expensesPaise = 60000; // ₹600 (Petrol ₹300 + Food ₹200 + Other ₹100)
    const summary = summarizeSales(sales, expensesPaise);

    assert.equal(summary.grossSalesPaise, 1000000); // ₹10,000
    assert.equal(summary.totalEarningsPaise, 100000); // ₹1,000 Salesperson Earnings
    assert.equal(summary.totalExpensesPaise, 60000);   // ₹600 Total Expenses
    assert.equal(summary.netCollectionPaise, 840000);  // ₹8,400 Company Payable
  });

  it("Test B — Expenses Do Not Reduce Salesperson Earnings", () => {
    const sales: SaleRecord[] = [{
      id: "s1",
      productId: "p1",
      productName: "Item",
      unitPricePaise: 2500000,
      normalCommissionPaise: 250000,
      fullCommissionPaise: 0,
      rewardThreshold: 12,
      quantity: 1,
      normalUnits: 1,
      fullUnits: 0,
      grossSalesPaise: 2500000,
      totalNormalCommissionPaise: 250000,
      totalFullCommissionPaise: 0,
      totalEarningsPaise: 250000,
      netCollectionPaise: 2250000,
      finalProgress: 1,
      finalCycle: 1,
      fullCommissionCycles: [],
      returnedQuantity: 0,
      createdAt: new Date().toISOString(),
    }];

    const expensesPaise = 100000; // ₹1,000 expenses
    const summary = summarizeSales(sales, expensesPaise);

    // Salesperson Earnings MUST remain ₹2,500 (250_000 paise), NOT reduced to ₹1,500
    assert.equal(summary.totalEarningsPaise, 250000);
    assert.equal(summary.netCollectionPaise, 2150000); // ₹21,500 Company Payable
  });

  it("Test J — Full Commission With Expenses (Company Payable can go negative)", () => {
    // Gross: ₹1,000, Full Commission: ₹1,000, Expenses: ₹200
    const sales: SaleRecord[] = [{
      id: "s1",
      productId: "p1",
      productName: "Item",
      unitPricePaise: 100000,
      normalCommissionPaise: 0,
      fullCommissionPaise: 100000,
      rewardThreshold: 12,
      quantity: 1,
      normalUnits: 0,
      fullUnits: 1,
      grossSalesPaise: 100000,
      totalNormalCommissionPaise: 0,
      totalFullCommissionPaise: 100000,
      totalEarningsPaise: 100000,
      netCollectionPaise: 0,
      finalProgress: 0,
      finalCycle: 2,
      fullCommissionCycles: [1],
      returnedQuantity: 0,
      createdAt: new Date().toISOString(),
    }];

    const expensesPaise = 20000; // ₹200 expenses
    const summary = summarizeSales(sales, expensesPaise);

    assert.equal(summary.totalEarningsPaise, 100000);  // ₹1,000
    assert.equal(summary.totalExpensesPaise, 20000);   // ₹200
    assert.equal(summary.netCollectionPaise, -20000);  // -₹200 Company Payable
  });

  it("Test K — Normal and Full Commission Together With Expenses", () => {
    // Sale 1 (Normal): Gross ₹5,000, Normal Commission ₹500
    // Sale 2 (Full): Gross ₹1,000, Full Commission ₹1,000
    // Expenses: ₹400 (Petrol ₹200 + Food ₹100 + Other ₹100)
    const sales: SaleRecord[] = [
      {
        id: "s1",
        productId: "p1",
        productName: "Item A",
        unitPricePaise: 500000,
        normalCommissionPaise: 50000,
        fullCommissionPaise: 0,
        rewardThreshold: 12,
        quantity: 1,
        normalUnits: 1,
        fullUnits: 0,
        grossSalesPaise: 500000,
        totalNormalCommissionPaise: 50000,
        totalFullCommissionPaise: 0,
        totalEarningsPaise: 50000,
        netCollectionPaise: 450000,
        finalProgress: 1,
        finalCycle: 1,
        fullCommissionCycles: [],
        returnedQuantity: 0,
        createdAt: new Date().toISOString(),
      },
      {
        id: "s2",
        productId: "p2",
        productName: "Item B",
        unitPricePaise: 100000,
        normalCommissionPaise: 0,
        fullCommissionPaise: 100000,
        rewardThreshold: 12,
        quantity: 1,
        normalUnits: 0,
        fullUnits: 1,
        grossSalesPaise: 100000,
        totalNormalCommissionPaise: 0,
        totalFullCommissionPaise: 100000,
        totalEarningsPaise: 100000,
        netCollectionPaise: 0,
        finalProgress: 0,
        finalCycle: 2,
        fullCommissionCycles: [1],
        returnedQuantity: 0,
        createdAt: new Date().toISOString(),
      },
    ];

    const expensesPaise = 40000; // ₹400 expenses
    const summary = summarizeSales(sales, expensesPaise);

    assert.equal(summary.grossSalesPaise, 600000);      // ₹6,000
    assert.equal(summary.totalEarningsPaise, 150000);   // ₹1,500
    assert.equal(summary.totalExpensesPaise, 40000);    // ₹400
    assert.equal(summary.netCollectionPaise, 410000);   // ₹4,100 (6000 - 1500 - 400 = 4100)
  });
});

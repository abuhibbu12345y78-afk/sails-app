export type Money = number;

export interface CommissionRule {
  sellingPricePaise: Money;
  normalCommissionPaise: Money;
  fullCommissionPaise: Money;
  rewardThreshold: number;
}

export interface CalculateSaleInput {
  quantity: number;
  currentProgress: number;
  currentCycle: number;
  rule: CommissionRule;
}

export interface CommissionCalculationResult {
  quantity: number;
  normalUnits: number;
  fullUnits: number;
  grossSalesPaise: Money;
  totalNormalCommissionPaise: Money;
  totalFullCommissionPaise: Money;
  totalEarningsPaise: Money;
  netCollectionPaise: Money;
  finalProgress: number;
  finalCycle: number;
  fullCommissionCycles: number[];
}

function assertSafeMoney(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

export function calculateSale(input: CalculateSaleInput): CommissionCalculationResult {
  const { rule } = input;
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) {
    throw new Error("Quantity must be a whole number between 1 and 999.");
  }
  if (!Number.isSafeInteger(rule.rewardThreshold) || rule.rewardThreshold < 1) {
    throw new Error("Reward threshold must be a positive whole number.");
  }
  if (!Number.isSafeInteger(input.currentProgress) || input.currentProgress < 0 || input.currentProgress > rule.rewardThreshold) {
    throw new Error("Current progress is invalid.");
  }
  assertSafeMoney(rule.sellingPricePaise, "Selling price");
  assertSafeMoney(rule.normalCommissionPaise, "Normal commission");
  assertSafeMoney(rule.fullCommissionPaise, "Full commission");

  let progress = input.currentProgress;
  let cycle = Math.max(1, input.currentCycle);
  let normalUnits = 0;
  let fullUnits = 0;
  const fullCommissionCycles: number[] = [];

  for (let unit = 0; unit < input.quantity; unit += 1) {
    if (progress === rule.rewardThreshold) {
      fullUnits += 1;
      fullCommissionCycles.push(cycle);
      progress = 0;
      cycle += 1;
    } else {
      normalUnits += 1;
      progress += 1;
    }
  }

  const grossSalesPaise = rule.sellingPricePaise * input.quantity;
  const totalNormalCommissionPaise = rule.normalCommissionPaise * normalUnits;
  const totalFullCommissionPaise = rule.fullCommissionPaise * fullUnits;
  const totalEarningsPaise = totalNormalCommissionPaise + totalFullCommissionPaise;
  const netCollectionPaise = grossSalesPaise - totalEarningsPaise;
  [grossSalesPaise, totalNormalCommissionPaise, totalFullCommissionPaise, totalEarningsPaise, netCollectionPaise]
    .forEach((value) => assertSafeMoney(value, "Calculated money"));

  return {
    quantity: input.quantity,
    normalUnits,
    fullUnits,
    grossSalesPaise,
    totalNormalCommissionPaise,
    totalFullCommissionPaise,
    totalEarningsPaise,
    netCollectionPaise,
    finalProgress: progress,
    finalCycle: cycle,
    fullCommissionCycles,
  };
}

export function formatCurrency(paise: Money, locale = "en-IN", currency = "INR") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

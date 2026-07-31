import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateSale } from "../src/domain/commission.ts";

const rule = {
  sellingPricePaise: 50_000,
  normalCommissionPaise: 5_000,
  fullCommissionPaise: 50_000,
  rewardThreshold: 12,
};

function calculate(currentProgress: number, quantity: number) {
  return calculateSale({ currentProgress, currentCycle: 1, quantity, rule });
}

describe("commission calculation", () => {
  it("records the first sale as Normal Commission", () => {
    const result = calculate(0, 1);
    assert.deepEqual(
      [result.normalUnits, result.fullUnits, result.finalProgress, result.totalEarningsPaise],
      [1, 0, 1, 5_000],
    );
  });

  it("moves progress 11 / 12 to 12 / 12", () => {
    const result = calculate(11, 1);
    assert.deepEqual([result.normalUnits, result.fullUnits, result.finalProgress], [1, 0, 12]);
  });

  it("awards Full Commission only when progress is 12 / 12", () => {
    const result = calculate(12, 1);
    assert.deepEqual(
      [result.normalUnits, result.fullUnits, result.finalProgress, result.totalNormalCommissionPaise, result.totalFullCommissionPaise, result.netCollectionPaise],
      [0, 1, 0, 0, 50_000, 0],
    );
  });

  it("crosses a cycle boundary in a multi-quantity sale", () => {
    const result = calculate(10, 5);
    assert.deepEqual([result.normalUnits, result.fullUnits, result.finalProgress], [4, 1, 2]);
    assert.equal(result.grossSalesPaise, 250_000);
    assert.equal(result.totalEarningsPaise, 70_000);
    assert.equal(result.netCollectionPaise, 180_000);
  });

  it("supports multiple cycles in one sale", () => {
    const result = calculate(12, 27);
    assert.deepEqual([result.normalUnits, result.fullUnits, result.finalProgress], [24, 3, 0]);
    assert.deepEqual(result.fullCommissionCycles, [1, 2, 3]);
    assert.equal(result.finalCycle, 4);
  });

  it("keeps money as safe integers", () => {
    const result = calculate(0, 999);
    for (const value of [result.grossSalesPaise, result.totalNormalCommissionPaise, result.totalFullCommissionPaise, result.totalEarningsPaise, result.netCollectionPaise]) {
      assert.equal(Number.isSafeInteger(value), true);
    }
  });

  it("rejects invalid quantities and progress", () => {
    assert.throws(() => calculate(0, 0), /Quantity/);
    assert.throws(() => calculate(13, 1), /progress/);
  });
});

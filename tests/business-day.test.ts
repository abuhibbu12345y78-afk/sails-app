import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateServerOffset,
  formatBusinessDate,
  formatBusinessTime,
  formatWorkingDuration,
  toBusinessDate,
  trustedNow,
} from "../src/domain/business-time.ts";
import {
  deriveDaySessionStatus,
  isDateChangeWarning,
  validateDailySale,
} from "../src/domain/day-session.ts";
import { calculateSale } from "../src/domain/commission.ts";

describe("trusted business time", () => {
  it("converts UTC to the Asia/Kolkata business date at midnight", () => {
    const beforeMidnight = new Date("2026-07-30T18:29:59.000Z");
    const midnight = new Date("2026-07-30T18:30:00.000Z");
    assert.equal(toBusinessDate(beforeMidnight, "Asia/Kolkata"), "2026-07-30");
    assert.equal(toBusinessDate(midnight, "Asia/Kolkata"), "2026-07-31");
  });

  it("formats the configured business date and IST time", () => {
    const date = new Date("2026-07-31T09:34:25.000Z");
    assert.match(formatBusinessDate(date, "Asia/Kolkata", "en-IN"), /Friday, 31 July 2026/);
    assert.match(formatBusinessTime(date, "Asia/Kolkata", "en-IN"), /03:04:25 pm/i);
  });

  it("corrects an incorrect device clock using the server offset", () => {
    const server = new Date("2026-07-31T10:00:00.000Z");
    const incorrectDevice = new Date("2026-08-04T04:25:00.000Z");
    const offset = calculateServerOffset(server, incorrectDevice);
    assert.equal(trustedNow(incorrectDevice, offset).toISOString(), server.toISOString());
  });

  it("keeps persisted timestamps in UTC", () => {
    assert.equal(new Date("2026-07-31T15:00:00+05:30").toISOString(), "2026-07-31T09:30:00.000Z");
  });

  it("calculates working duration from trusted timestamps", () => {
    assert.equal(formatWorkingDuration(
      new Date("2026-07-31T03:05:00.000Z"),
      new Date("2026-07-31T13:50:00.000Z"),
    ), "10h 45m");
  });
});

describe("manual day transition", () => {
  it("shows a warning without automatically closing an older open session", () => {
    const session = { businessDate: "2026-07-30", status: "OPEN" as const };
    assert.equal(deriveDaySessionStatus("2026-07-31", session), "PREVIOUS_DAY_STILL_OPEN");
    assert.equal(session.status, "OPEN");
    assert.equal(isDateChangeWarning(session.businessDate, "2026-07-31"), true);
  });

  it("does not automatically create a session", () => {
    assert.equal(deriveDaySessionStatus("2026-07-31", null), "NOT_STARTED");
  });

  it("prevents sales for zero or insufficient daily stock", () => {
    assert.throws(() => validateDailySale({
      productId: "oil", pickedQuantity: 0, soldQuantity: 0, remainingQuantity: 0,
    }, 1), /not picked/i);
    assert.throws(() => validateDailySale({
      productId: "oil", pickedQuantity: 10, soldQuantity: 8, remainingQuantity: 2,
    }, 3), /Only 2 units remain/i);
  });

  it("keeps daily stock separate from persistent commission progress", () => {
    const stock = { productId: "ghee", pickedQuantity: 10, soldQuantity: 4, remainingQuantity: 6 };
    const commission = calculateSale({
      quantity: 1,
      currentProgress: 8,
      currentCycle: 2,
      rule: { sellingPricePaise: 50_000, normalCommissionPaise: 5_000, fullCommissionPaise: 50_000, rewardThreshold: 12 },
    });
    assert.equal(stock.remainingQuantity, 6);
    assert.equal(commission.finalProgress, 9);
    assert.equal(commission.finalCycle, 2);
  });

  it("does not reset commission progress during conceptual Day Start or Day Close", () => {
    const persistent = { progress: 11, cycle: 4 };
    const startDay = () => ({ picked: 5, sold: 0, remaining: 5 });
    const closeDay = () => ({ status: "CLOSED" });
    startDay();
    closeDay();
    assert.deepEqual(persistent, { progress: 11, cycle: 4 });
  });
});

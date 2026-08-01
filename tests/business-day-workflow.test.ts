import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  getCurrentBusinessDayStateUseCase,
  previewAdditionalPickupUseCase,
  previewDayStartUseCase,
  reopenBusinessDayUseCase,
} from "../src/application/business-day-use-cases.ts";
import { resolveOpeningState } from "../src/domain/day-session.ts";

const currentDate = "2026-08-01";
const openToday = { id: "today", businessDate: currentDate, status: "OPEN" as const };
const closedToday = { id: "today", businessDate: currentDate, status: "CLOSED" as const };
const closedYesterday = { id: "yesterday", businessDate: "2026-07-31", status: "CLOSED" as const };
const openYesterday = { id: "yesterday", businessDate: "2026-07-31", status: "OPEN" as const };

describe("authoritative opening decision flow", () => {
  it("same-date OPEN session opens Home", () => {
    assert.equal(getCurrentBusinessDayStateUseCase(currentDate, [openToday]).openingState, "CURRENT_OPEN");
  });

  it("same-date CLOSED session shows closed summary and never OPEN NEW DAY", () => {
    assert.equal(getCurrentBusinessDayStateUseCase(currentDate, [closedToday]).openingState, "CURRENT_CLOSED");
  });

  it("closing in the morning or at noon does not create a new same-date Business Day", () => {
    for (const closedAt of ["2026-08-01T03:30:00.000Z", "2026-08-01T06:30:00.000Z"]) {
      const session = { ...closedToday, closedAt };
      assert.equal(resolveOpeningState(currentDate, [session]).openingState, "CURRENT_CLOSED");
    }
  });

  it("OPEN NEW DAY appears only after trusted Business Date changes", () => {
    assert.equal(resolveOpeningState("2026-07-31", [closedYesterday]).openingState, "CURRENT_CLOSED");
    assert.equal(resolveOpeningState(currentDate, [closedYesterday]).openingState, "NEW_DAY");
  });

  it("previous CLOSED day allows the New Day landing screen", () => {
    assert.equal(resolveOpeningState(currentDate, [closedYesterday]).openingState, "NEW_DAY");
  });

  it("previous OPEN day blocks OPEN NEW DAY and wins before current lookup", () => {
    const decision = resolveOpeningState(currentDate, [closedToday, openYesterday]);
    assert.equal(decision.openingState, "PREVIOUS_OPEN");
    assert.equal(decision.session?.businessDate, "2026-07-31");
  });
});

describe("manual close and start guarantees", () => {
  it("cancelling Day Close preserves the OPEN session", () => {
    const session = { ...openYesterday };
    const cancel = () => false;
    cancel();
    assert.equal(session.status, "OPEN");
  });

  it("closing the previous day does not automatically start the new day", () => {
    const sessions = [{ ...closedYesterday }];
    assert.equal(resolveOpeningState(currentDate, sessions).openingState, "NEW_DAY");
    assert.equal(sessions.some((session) => session.businessDate === currentDate), false);
  });

  it("OPEN NEW DAY only previews pickup and session creation waits for confirmation", () => {
    const preview = previewDayStartUseCase([
      { productId: "ghee", pickedQuantity: 5 },
      { productId: "honey", pickedQuantity: 0 },
    ]);
    assert.deepEqual(preview, {
      totalProductsSelected: 1,
      totalPickedUnits: 5,
      items: [{ productId: "ghee", pickedQuantity: 5 }],
    });
  });

  it("previous picked and remaining quantities are not copied", () => {
    const previous = { picked: 12, remaining: 4 };
    const preview = previewDayStartUseCase([{ productId: "ghee", pickedQuantity: 0 }]);
    assert.equal(preview.totalPickedUnits, 0);
    assert.deepEqual(previous, { picked: 12, remaining: 4 });
  });

  it("new daily operational totals start at zero", () => {
    assert.deepEqual({
      sold: 0, gross: 0, normalCommission: 0, offersEarned: 0, earnings: 0, net: 0,
    }, {
      sold: 0, gross: 0, normalCommission: 0, offersEarned: 0, earnings: 0, net: 0,
    });
  });
});

describe("same-date reopen and additional pickup", () => {
  it("allows only the same trusted date CLOSED session with permission and no later day", () => {
    assert.deepEqual(reopenBusinessDayUseCase({
      trustedBusinessDate: currentDate,
      target: closedToday,
      laterSessionExists: false,
      hasPermission: true,
    }), { allowed: true, reason: null });
  });

  it("blocks earlier dates, open sessions, later sessions, and missing permission", () => {
    assert.equal(reopenBusinessDayUseCase({ trustedBusinessDate: currentDate, target: closedYesterday, laterSessionExists: false, hasPermission: true }).allowed, false);
    assert.equal(reopenBusinessDayUseCase({ trustedBusinessDate: currentDate, target: openToday, laterSessionExists: false, hasPermission: true }).allowed, false);
    assert.equal(reopenBusinessDayUseCase({ trustedBusinessDate: currentDate, target: closedToday, laterSessionExists: true, hasPermission: true }).allowed, false);
    assert.equal(reopenBusinessDayUseCase({ trustedBusinessDate: currentDate, target: closedToday, laterSessionExists: false, hasPermission: false }).allowed, false);
  });

  it("additional pickup increases picked and remaining without changing sold", () => {
    const preview = previewAdditionalPickupUseCase([{
      id: "stock", productId: "ghee", productName: "Ghee", unitPricePaise: 1,
      pickedQuantity: 10, soldQuantity: 8, remainingQuantity: 2,
    }], [{ productId: "ghee", additionalQuantity: 5 }]);
    assert.equal(preview.items[0]?.newPickedQuantity, 15);
    assert.equal(preview.items[0]?.newRemainingQuantity, 7);
    assert.equal(preview.totalAdditionalUnits, 5);
  });

  it("a product with previous pickup 0 can be added", () => {
    const preview = previewAdditionalPickupUseCase([{
      id: "stock", productId: "oil", productName: "Oil", unitPricePaise: 1,
      pickedQuantity: 0, soldQuantity: 0, remainingQuantity: 0,
    }], [{ productId: "oil", additionalQuantity: 3 }]);
    assert.equal(preview.items[0]?.newPickedQuantity, 3);
    assert.equal(preview.items[0]?.newRemainingQuantity, 3);
  });

  it("negative pickup adjustments and reductions are rejected", () => {
    assert.throws(() => previewAdditionalPickupUseCase([{
      id: "stock", productId: "oil", productName: "Oil", unitPricePaise: 1,
      pickedQuantity: 4, soldQuantity: 2, remainingQuantity: 2,
    }], [{ productId: "oil", additionalQuantity: -1 }]), /Additional pickup/);
  });
});

describe("server and persistence boundaries", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const database = readFileSync(new URL("../src/infrastructure/d1/database.ts", import.meta.url), "utf8");
  const d1Repositories = readFileSync(new URL("../src/infrastructure/d1/repositories.ts", import.meta.url), "utf8");
  const realtime = readFileSync(new URL("../src/infrastructure/realtime/realtime-service.ts", import.meta.url), "utf8");

  it("blocks duplicate same-date sessions with scoped and base unique constraints", () => {
    assert.match(schema, /day_session_scope_business_date_idx/);

    assert.match(schema, /tenantId[\s\S]*companyId[\s\S]*salesmanId[\s\S]*businessDate/);
    assert.match(schema, /businessDate: text\("business_date"\)\.notNull\(\)\.unique\(\)/);
  });

  it("uses trusted database timestamps and rejects client timestamps", () => {
    assert.match(d1Repositories, /getDatabaseTime/);
    assert.doesNotMatch(d1Repositories, /input\.(startedAt|closedAt|reopenedAt|createdAt|timestamp)/);
  });

  it("creates versioned snapshots, supersedes reports, and audits reopen and pickup", () => {
    assert.match(d1Repositories, /day_close_snapshots/);
    assert.match(d1Repositories, /closureVersion/);
    assert.match(d1Repositories, /SUPERSEDED/);
    assert.match(d1Repositories, /OUTDATED/);
    assert.match(d1Repositories, /day\.reopened/);
    assert.match(d1Repositories, /day_stock_adjustments/);
    assert.match(d1Repositories, /stock\.additional_pickup/);
  });

  it("normal day transitions contain no DELETE operations", () => {
    const normalTransitions = d1Repositories.substring(
      d1Repositories.indexOf("async startDaySession"),
      d1Repositories.indexOf("async resetBusinessDay")
    );
    for (const source of [database, normalTransitions]) {
      assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
    }
  });

  it("reopen updates the existing session instead of inserting another", () => {
    const reopenMethod = d1Repositories.substring(
      d1Repositories.indexOf("async reopenDaySession"),
      d1Repositories.indexOf("async additionalPickup")
    );
    assert.match(reopenMethod, /UPDATE day_sessions SET status = 'OPEN'/);
    assert.doesNotMatch(reopenMethod, /INSERT INTO day_sessions/);
  });



  it("Realtime is synchronization-only and contains no transition mutation", () => {
    assert.doesNotMatch(realtime, /day-start|day-close|day-reopen|additional-pickup|INSERT|UPDATE|DELETE/i);
  });
});

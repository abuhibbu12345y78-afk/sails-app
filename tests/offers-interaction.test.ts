import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";

describe("Offers Interaction & Mapping Tests", () => {
  test("Supabase repository maps product_name_snapshot correctly (no undefined)", () => {
    const code = readFileSync("src/infrastructure/supabase/repositories.ts", "utf8");
    assert.match(code, /productName:\s*String\(row\.product_name_snapshot/);
    assert.doesNotMatch(code, /productName:\s*String\(row\.product_name\)/);
  });

  test("Offer Contract includes productId and receivedAt", () => {
    const code = readFileSync("src/application/contracts.ts", "utf8");
    assert.match(code, /productId\?: string/);
    assert.match(code, /receivedAt\?: string \| null/);
  });

  test("API routes for receive and undo exist and map to provider methods", () => {
    const receiveCode = readFileSync("app/api/offers/receive/route.ts", "utf8");
    const undoCode = readFileSync("app/api/offers/undo/route.ts", "utf8");
    
    assert.match(receiveCode, /provider\.sale\.markOfferReceived\(rewardId\)/);
    assert.match(undoCode, /provider\.sale\.undoOfferReceived\(rewardId\)/);
  });

  test("UI component supports interactive EARNED row, RECEIVED amber state, and UNDO button", () => {
    const trackerCode = readFileSync("src/components/tracker-app.tsx", "utf8");
    
    assert.match(trackerCode, /Mark this Offer as Received\?/);
    assert.match(trackerCode, /Undo Received Status\?/);
    assert.match(trackerCode, /Tap to mark as received/);
    assert.match(trackerCode, /\/api\/offers\/undo/);
    assert.match(trackerCode, /\/api\/offers\/receive/);
    assert.match(trackerCode, /received-card/);
    assert.match(trackerCode, /amber-badge/);
  });
});

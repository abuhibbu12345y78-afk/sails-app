import { SupabaseStateRepository, SupabaseDaySessionRepository, SupabaseSaleRepository } from '../src/infrastructure/supabase/repositories';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getVar = (name: string) => {
  const line = env.split('\n').find(l => l.trim().startsWith(name + '='));
  return line ? line.split('=').slice(1).join('=').trim() : undefined;
};

// Force provider to supabase
process.env.DATABASE_PROVIDER = 'supabase';
process.env.NEXT_PUBLIC_APP_URL = getVar('NEXT_PUBLIC_APP_URL') || '';
process.env.NEXT_PUBLIC_SUPABASE_URL = getVar('NEXT_PUBLIC_SUPABASE_URL') || '';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = getVar('NEXT_PUBLIC_SUPABASE_ANON_KEY') || '';
process.env.SUPABASE_SERVICE_ROLE_KEY = getVar('SUPABASE_SERVICE_ROLE_KEY');

async function runE2E() {
  console.log("🚀 Starting Supabase E2E Workflow Test...");
  try {
    const stateRepo = new SupabaseStateRepository();
    const dayRepo = new SupabaseDaySessionRepository();
    const saleRepo = new SupabaseSaleRepository();
    
    // 1. Get initial state
    let state = await stateRepo.getTrackerState();
    console.log("✅ Initial Tracker State Fetched.");
    console.log(`Current Status: ${state.daySessionStatus}`);

    // If a session is open, close it to start fresh
    if (state.daySessionStatus === 'OPEN' && state.daySession) {
      await dayRepo.closeDaySession(state.daySession.id);
      console.log("✅ Closed dangling session from previous runs.");
    }
    
    state = await stateRepo.getTrackerState();
    
    // 2. Day Start
    const startResult = await dayRepo.startDaySession({
      items: [
        { productId: state.products[0].id, pickedQuantity: 50 },
        { productId: state.products[1].id, pickedQuantity: 50 }
      ]
    });
    console.log(`✅ Day Started: ${startResult.id}`);

    // 3. Sales
    console.log("Recording 12 sales to trigger threshold...");
    for (let i = 0; i < 12; i++) {
      await saleRepo.createSale({
        productId: state.products[0].id,
        quantity: 1,
        idempotencyKey: crypto.randomUUID()
      });
    }
    console.log("✅ 12 Sales recorded.");

    // 4. Commission and Offers
    // 13th sale
    await saleRepo.createSale({
      productId: state.products[0].id,
      quantity: 1,
      idempotencyKey: crypto.randomUUID()
    });
    console.log("✅ 13th Sale recorded (Offer Triggered).");
    
    // Verify offer earned
    state = await stateRepo.getTrackerState();
    const earnedOffer = state.rewards.find(r => r.cycleNumber === 1 && r.status === 'EARNED');
    if (!earnedOffer) throw new Error("Offer was not earned!");
    console.log("✅ Offer EARNED successfully.");

    // 5. Offer Receipt
    await saleRepo.markOfferReceived(earnedOffer.id);
    state = await stateRepo.getTrackerState();
    const receivedOffer = state.rewards.find(r => r.id === earnedOffer.id);
    if (!receivedOffer || receivedOffer.status !== 'RECEIVED') throw new Error("Offer was not marked RECEIVED!");
    console.log("✅ Offer RECEIVED successfully.");

    // 6. Day Close
    const closeResult = await dayRepo.closeDaySession(startResult.id);
    console.log(`✅ Day Closed. Closure Version: ${closeResult.closureVersion}`);

    // 7. Reopen and Additional Pickup
    const reopenResult = await dayRepo.reopenDaySession({
      sessionId: startResult.id,
      reason: "E2E Test Reopen"
    });
    console.log(`✅ Day Reopened. Reopen Count: ${reopenResult.reopenCount}`);

    const pickupResult = await dayRepo.additionalPickup({
      sessionId: startResult.id,
      reason: "E2E Test Additional Pickup",
      items: [
        { productId: state.products[0].id, additionalQuantity: 10 }
      ]
    });
    console.log(`✅ Additional Pickup recorded. Total Added: ${pickupResult.totalAdditionalUnits}`);

    // Re-close
    const close2Result = await dayRepo.closeDaySession(startResult.id);
    console.log(`✅ Day Re-Closed. Closure Version: ${close2Result.closureVersion}`);

    console.log("🎉 ALL E2E WORKFLOW TESTS PASSED SUCCESSFULLY!");
    
  } catch (err) {
    console.error("❌ E2E TEST FAILED:", err);
    process.exit(1);
  }
}

// Run using tsx since repositories are TS
// We will call this script via tsx.
runE2E();

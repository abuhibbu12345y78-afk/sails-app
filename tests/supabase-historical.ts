import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const env = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
const getVar = (name: string) => {
  const line = env.split('\n').find(l => l.trim().startsWith(name + '='));
  if (!line) return undefined;
  return line.split('=').slice(1).join('=').trim();
};

const supabaseUrl = getVar('NEXT_PUBLIC_SUPABASE_URL')!;
const serviceKey = getVar('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, serviceKey);

async function run() {
  console.log("🚀 Starting Historical Data Entry Test...");

  // Get active salesman context
  const { data: salesmen } = await supabase.from('salesmen').select('*').limit(1).single();
  const { data: products } = await supabase.from('products').select('*');
  
  if (!salesmen || !products) {
    console.error("❌ Need seed data");
    process.exit(1);
  }

  const ghee = products[0];
  if (!ghee) throw new Error("No products found");

  // Clear if exists
  await supabase.from('full_commission_rewards').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('day_closures').delete().in('business_date', ['2024-01-01', '2024-01-02', '2024-01-03']);
  await supabase.from('day_stock_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('day_sessions').delete().in('business_date', ['2024-01-01', '2024-01-02', '2024-01-03']);
  await supabase.from('commission_progress').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Step 1: Insert Day 1 (12 sales)
  console.log("Submitting Day 1 (12 sales)...");
  let res = await supabase.rpc('historical_data_entry_atomic', {
    p_salesman_id: salesmen.id,
    p_business_date: '2024-01-01',
    p_pickup_items: [{ product_id: ghee.id, picked_quantity: 20 }],
    p_sales_items: [{ product_id: ghee.id, quantity: 12 }]
  });
  if (res.error) throw new Error("Day 1 failed: " + res.error.message);

  // Step 2: Insert Day 3 (5 sales) -> Triggers Offer
  console.log("Submitting Day 3 (5 sales)...");
  res = await supabase.rpc('historical_data_entry_atomic', {
    p_salesman_id: salesmen.id,
    p_business_date: '2024-01-03',
    p_pickup_items: [{ product_id: ghee.id, picked_quantity: 20 }],
    p_sales_items: [{ product_id: ghee.id, quantity: 5 }]
  });
  if (res.error) throw new Error("Day 3 failed: " + res.error.message);

  // Step 3: Mark Offer Received
  const { data: rewards } = await supabase.from('full_commission_rewards').select('*');
  if (!rewards || rewards.length === 0) throw new Error("No reward generated!");
  console.log("Marking reward as received...");
  const updateRes = await supabase.from('full_commission_rewards').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', rewards[0].id);
  if (updateRes.error) throw new Error("Failed to mark received: " + updateRes.error.message);

  // Step 4: Insert Day 2 (Historical) (5 sales) -> Should throw conflict
  console.log("Submitting Day 2 (Historical) -> Expecting Conflict...");
  const { data, error } = await supabase.rpc('historical_data_entry_atomic', {
    p_salesman_id: salesmen.id,
    p_business_date: '2024-01-02',
    p_pickup_items: [{ product_id: ghee.id, picked_quantity: 20 }],
    p_sales_items: [{ product_id: ghee.id, quantity: 5 }]
  });

  if (error && error.message.includes('received_offer_conflict')) {
    console.log("✅ RECEIVED_OFFER_CONFLICT caught successfully!");
  } else {
    console.error("❌ Test Failed: Expected conflict, but got:", error ? error.message : "Success");
    process.exit(1);
  }

  console.log("🎉 HISTORICAL DATA TEST PASSED SUCCESSFULLY!");
}

run().catch(err => {
  console.error("❌ Unhandled Error:", err);
  process.exit(1);
});

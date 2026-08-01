import test, { describe, it } from 'node:test';
import assert from 'node:assert';
import { SupabaseStateRepository, SupabaseSettingsRepository } from '../src/infrastructure/supabase/repositories.ts';

describe('Supabase PostgreSQL Repositories Integration', () => {
  it('fetches initial tracker state from live Supabase DB', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const stateRepo = new SupabaseStateRepository();
    const state = await stateRepo.getTrackerState();
    assert.strictEqual(typeof state, 'object');
    assert.ok(Array.isArray(state.products));
    assert.ok(state.products.length >= 9, 'Should load 9 seeded products');
  });

  it('fetches application settings from live Supabase DB', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const settingsRepo = new SupabaseSettingsRepository();
    const settings = await settingsRepo.getSettings();
    assert.strictEqual(typeof settings.businessName, 'string');
    assert.ok(settings.businessName.length > 0);
  });
});

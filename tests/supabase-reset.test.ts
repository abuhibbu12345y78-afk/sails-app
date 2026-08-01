import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...vals] = trimmed.split('=');
        if (key && !process.env[key.trim()]) {
          process.env[key.trim()] = vals.join('=').trim();
        }
      }
    }
  }
} catch {
  // Ignore env loading errors
}

import { SupabaseStateRepository, SupabaseDaySessionRepository } from '../src/infrastructure/supabase/repositories.ts';

describe('Supabase Reset & Pagination Integration Tests', () => {
  it('fetches initial state and verifies backend pagination range filtering', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const stateRepo = new SupabaseStateRepository();
    
    // Page 1 with pageSize 5
    const page1 = await stateRepo.getTrackerState({ page: 1, pageSize: 5 });
    assert.ok(Array.isArray(page1.historySales));
    assert.ok(page1.historySales.length <= 5);
    
    // Page 2 with pageSize 5
    const page2 = await stateRepo.getTrackerState({ page: 2, pageSize: 5 });
    assert.ok(Array.isArray(page2.historySales));
    assert.ok(page2.historySales.length <= 5);
  });

  it('rejects resetting non-existent or unowned session', async () => {
    process.env.DATABASE_PROVIDER = 'supabase';
    const daySessionRepo = new SupabaseDaySessionRepository();
    
    await assert.rejects(
      async () => {
        await daySessionRepo.resetBusinessDay('00000000-0000-0000-0000-000000000000');
      },
      (err: Error) => {
        assert.ok(err.message.length > 0);
        return true;
      }
    );
  });
});

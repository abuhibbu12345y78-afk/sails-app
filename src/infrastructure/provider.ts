import type { DatabaseProvider } from "../application/repositories";
import { D1DaySessionRepository, D1SaleRepository, D1SettingsRepository, D1StateRepository } from "./d1/repositories";
import { SupabaseDaySessionRepository, SupabaseSaleRepository, SupabaseSettingsRepository, SupabaseStateRepository, SupabaseExpenseRepository } from "./supabase/repositories";

function createProvider(): DatabaseProvider {
  if (process.env.DATABASE_PROVIDER === "supabase") {
    return {
      daySession: new SupabaseDaySessionRepository(),
      sale: new SupabaseSaleRepository(),
      settings: new SupabaseSettingsRepository(),
      state: new SupabaseStateRepository(),
      expense: new SupabaseExpenseRepository(),
    };
  }
  
  // Default to D1
  return {
    daySession: new D1DaySessionRepository(),
    sale: new D1SaleRepository(),
    settings: new D1SettingsRepository(),
    state: new D1StateRepository(),
    expense: {} as any,
  };
}

export const provider: DatabaseProvider = createProvider();

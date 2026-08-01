import type { DatabaseProvider, ExpenseRepository } from "../application/repositories";
import { D1DaySessionRepository, D1SaleRepository, D1SettingsRepository, D1StateRepository } from "./d1/repositories";
import { SupabaseDaySessionRepository, SupabaseSaleRepository, SupabaseSettingsRepository, SupabaseStateRepository, SupabaseExpenseRepository } from "./supabase/repositories";

class D1UnsupportedExpenseRepository implements ExpenseRepository {
  private unsupported(): never {
    throw new Error("D1 expenses are not supported. Ensure DATABASE_PROVIDER=supabase is set.");
  }
  addExpense(): Promise<never> { return this.unsupported(); }
  updateExpense(): Promise<never> { return this.unsupported(); }
  deleteExpense(): Promise<never> { return this.unsupported(); }
  getExpenses(): Promise<never> { return this.unsupported(); }
}

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
    expense: new D1UnsupportedExpenseRepository(),
  };
}

export const provider: DatabaseProvider = createProvider();

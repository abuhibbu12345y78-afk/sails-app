import { SupabaseClient } from "@supabase/supabase-js";

export interface ActiveContext {
  salesmanId: string;
  companyId: string;
  tenantId: string;
}

/**
 * Resolves the active context for the single-salesman application.
 * In a multi-tenant application, this would derive from the authenticated user.
 */
export async function getActiveContext(supabase: SupabaseClient): Promise<ActiveContext> {
  const { data, error } = await supabase
    .from("salesmen")
    .select("id, company_id, tenant_id")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve active salesman context: ${error.message}`);
  }
  if (!data) {
    throw new Error("No active salesman found in the database. Please ensure seed data is applied.");
  }

  return {
    salesmanId: data.id,
    companyId: data.company_id,
    tenantId: data.tenant_id,
  };
}

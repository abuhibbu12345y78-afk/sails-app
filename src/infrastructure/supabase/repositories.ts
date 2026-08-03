import { createAdminClient } from "./client.ts";
import type {
  DaySessionRepository,
  SaleRepository,
  SettingsRepository,
  StateRepository,
  StartDayInput,
  StartDayResult,
  CloseDayResult,
  ReopenDayInput,
  ReopenDayResult,
  AdditionalPickupInput,
  AdditionalPickupResult,
  HistoricalDataInput,
  HistoricalDataResult,
  CreateSaleInput, 
  CreateSaleResult,
  ReturnSaleInput,
  ReturnSaleResult,
  ExpenseRepository,
  CreateExpenseInput
} from "../../application/repositories.ts";
import type {
  TrackerState,
  DaySession,
  SaleRecord,
  DayCloseSnapshot,
  AppSettings,
  DateFilterOptions,
  TrustedTimeState,
  FullCommissionReward,
  DayExpense,
  DashboardSummary
} from "../../application/contracts.ts";
import { DomainError } from "../../application/errors.ts";
import { parseDatabaseTimestamp } from "./client.ts";
import { getActiveContext } from "./context.ts";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../domain/business-time.ts";
import { summarizeSales } from "../../application/summary.ts";
import { getCurrentBusinessDayStateUseCase, reopenBusinessDayUseCase, canResetBusinessDayUseCase } from "../../application/business-day-use-cases.ts";

type DbRow = Record<string, unknown>;

function isoTimestamp(dbVal: unknown): string {
  if (!dbVal) return new Date().toISOString();
  return parseDatabaseTimestamp(String(dbVal)).toISOString();
}

async function getDatabaseTime(timezone: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("get_trusted_time");
  if (error) throw new Error("Failed to get trusted time: " + error.message);
  
  const typedData = data as { server_time: string }[];
  const serverTimeIso = parseDatabaseTimestamp(typedData[0]?.server_time ?? new Date().toISOString()).toISOString();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(serverTimeIso));
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const businessDate = `${year}-${month}-${day}`;
  return { businessDate, serverTimeIso, timezone };
}

export class SupabaseSettingsRepository implements SettingsRepository {
  async getSettings(): Promise<AppSettings> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data: settingsRow, error } = await supabase.from('app_settings').select('*').eq('company_id', context.companyId).maybeSingle();
    if (error) throw new Error(error.message);
    const { data: salesmanData, error: sErr } = await supabase.from('salesmen').select('display_name').eq('id', context.salesmanId).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    
    return {
      salesmanName: String(salesmanData?.display_name ?? "Salesman"),
      businessName: String(settingsRow?.business_name ?? "AL QUWWA"),
      whatsappNumber: String(settingsRow?.whatsapp_report_number ?? ""),
      currency: String(settingsRow?.currency ?? "INR"),
      locale: String(settingsRow?.locale ?? "en-IN"),
      timezone: String(settingsRow?.timezone ?? DEFAULT_BUSINESS_TIMEZONE),
      realtimeEnabled: Boolean(settingsRow?.realtime_enabled ?? true),
    };
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<void> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);

    if (settings.salesmanName !== undefined) {
      const { error } = await supabase.from('salesmen').update({ display_name: settings.salesmanName }).eq('id', context.salesmanId);
      if (error) throw new Error(error.message);
    }

    const updateData: Record<string, string | boolean> = {};
    if (settings.businessName !== undefined) updateData.business_name = settings.businessName;
    if (settings.whatsappNumber !== undefined) updateData.whatsapp_report_number = settings.whatsappNumber;
    if (settings.realtimeEnabled !== undefined) updateData.realtime_enabled = settings.realtimeEnabled;

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase.from('app_settings').update(updateData).eq('company_id', context.companyId);
      if (error) throw new Error(error.message);
    }
  }
}

export class SupabaseDaySessionRepository implements DaySessionRepository {
  async startDaySession(input: StartDayInput): Promise<StartDayResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    
    const payload = input.items.map((item) => ({
      product_id: item.productId,
      picked_quantity: item.pickedQuantity,
    }));

    const { data, error } = await supabase.rpc("start_day_atomic", {
      p_salesman_id: context.salesmanId,
      p_items: payload,
    });
    
    if (error) {
      if (error.message.includes('previous_day_still_open')) throw new DomainError("The previous business day is still open.");
      if (error.message.includes('invalid_day_stock')) throw new DomainError("One or more selected products are unavailable or invalid.", 400);
      throw new Error(`start_day_atomic failed: ${error.message}`);
    }

    return { id: String(data.id), businessDate: String(data.business_date), startedAt: isoTimestamp(data.started_at) };
  }

  async closeDaySession(_sessionId: string): Promise<CloseDayResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data: settings, error: settErr } = await supabase.from('app_settings').select('*').eq('company_id', context.companyId).single();
    if (settErr) throw new Error(`Failed to fetch settings: ${settErr.message}`);
    const time = await getDatabaseTime(String(settings.timezone));

    const { data, error } = await supabase.rpc("close_day_atomic", {
      p_salesman_id: context.salesmanId,
    });
    if (error) {
       if (error.message.includes('open_day_not_found')) throw new DomainError("There is no open business day to close.");
       throw new Error(`close_day_atomic failed: ${error.message}`);
    }

    const { data: closure, error: closeErr } = await supabase.from('day_closures')
       .select('*')
       .eq('salesman_id', context.salesmanId)
       .eq('business_date', data.business_date)
       .eq('status', 'ACTIVE')
       .single();
       
    if (closeErr) throw new Error(`Failed to fetch closure summary: ${closeErr.message}`);

    return {
      id: String(closure.id),
      reportText: String(closure.report_text),
      whatsappNumber: String(settings.whatsapp_report_number ?? ""),
      closedAt: time.serverTimeIso,
      businessDate: String(data.business_date),
      closureVersion: Number(closure.closure_version),
    };
  }

  async reopenDaySession(input: ReopenDayInput): Promise<ReopenDayResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data: settings, error: settErr } = await supabase.from('app_settings').select('timezone').eq('company_id', context.companyId).single();
    if (settErr) throw new Error(settErr.message);
    const time = await getDatabaseTime(String(settings.timezone));

    const { data, error } = await supabase.rpc("reopen_day_atomic", {
      p_salesman_id: context.salesmanId,
      p_reason: input.reason,
    });

    if (error) {
      if (error.message.includes('previous_day_still_open')) throw new DomainError("Another Business Day is already open.");
      if (error.message.includes('session_not_found')) throw new DomainError("The Business Day could not be found.", 404);
      if (error.message.includes('session_not_closed')) throw new DomainError("The Business Day is not closed.");
      throw new Error(`reopen_day_atomic failed: ${error.message}`);
    }

    return {
      sessionId: input.sessionId,
      reopenCount: Number(data.reopen_count),
      reopenedAt: time.serverTimeIso,
    };
  }

  async additionalPickup(input: AdditionalPickupInput): Promise<AdditionalPickupResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data: settings, error: settErr } = await supabase.from('app_settings').select('timezone').eq('company_id', context.companyId).single();
    if (settErr) throw new Error(settErr.message);
    const time = await getDatabaseTime(String(settings.timezone));

    const payload = input.items.map((item) => ({
      product_id: item.productId,
      additional_quantity: item.additionalQuantity,
    }));

    const { data: stockBefore, error: bErr } = await supabase.from('day_stock_items').select('*').eq('day_session_id', input.sessionId);
    if (bErr) throw new Error(bErr.message);

    const { error } = await supabase.rpc("additional_pickup_atomic", {
      p_salesman_id: context.salesmanId,
      p_items: payload,
      p_reason: input.reason,
    });

    if (error) {
      if (error.message.includes('open_day_not_found')) throw new DomainError("The reopened Business Day is no longer open.");
      if (error.message.includes('reopen_required')) throw new DomainError("Reopen the current Business Day before adding pickup.");
      if (error.message.includes('product_not_found_in_session')) throw new DomainError("One or more products are unavailable.", 400);
      throw new Error(`additional_pickup_atomic failed: ${error.message}`);
    }
    
    let totalUnits = 0;
    type PayloadItem = { product_id: string; additional_quantity: number };
    const items = payload.filter((p: PayloadItem) => p.additional_quantity > 0).map((p: PayloadItem) => {
       const before = stockBefore?.find(s => s.product_id === p.product_id);
       totalUnits += p.additional_quantity;
       return {
         productId: p.product_id,
         additionalQuantity: p.additional_quantity,
         previousPickedQuantity: Number(before?.picked_quantity || 0),
         previousRemainingQuantity: Number(before?.remaining_quantity || 0),
         newPickedQuantity: Number(before?.picked_quantity || 0) + p.additional_quantity,
         newRemainingQuantity: Number(before?.remaining_quantity || 0) + p.additional_quantity,
       };
    });

    return {
      sessionId: input.sessionId,
      totalAdditionalUnits: totalUnits,
      items,
      createdAt: time.serverTimeIso,
    };
  }

  async correctPickup(input: import("../../application/repositories").CorrectPickupInput): Promise<import("../../application/repositories").CorrectPickupResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data, error } = await supabase.rpc("correct_additional_pickup_atomic", {
      p_salesman_id: context.salesmanId,
      p_audit_log_id: input.auditLogId,
      p_product_id: input.productId,
      p_corrected_quantity: input.correctedQuantity,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
      if (error.message.includes('permission_denied')) throw new DomainError("Permission denied.");
      if (error.message.includes('day_not_open')) throw new DomainError("Cannot correct pickup: Business Day is not open.", 400);
      if (error.message.includes('product_not_found_in_pickup')) throw new DomainError("Product not found in this pickup log.", 404);
      if (error.message.includes('exceeds_sold_quantity')) throw new DomainError("ഇതിനകം വിറ്റ അളവിനേക്കാൾ കുറവായി സ്റ്റോക്ക് തിരുത്താൻ കഴിയില്ല.", 400);
      if (error.message.includes('invalid_quantity')) throw new DomainError("Corrected quantity must be 0 or greater.", 400);
      throw new Error(`correct_additional_pickup_atomic failed: ${error.message}`);
    }

    return { accepted: true };
  }

  async submitHistoricalData(input: HistoricalDataInput): Promise<HistoricalDataResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);

    const pickupPayload = input.pickupItems.map((item) => ({
      product_id: item.productId,
      picked_quantity: item.pickedQuantity,
    }));

    const salesPayload = input.salesItems.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    }));

    const { data, error } = await supabase.rpc("historical_data_entry_atomic", {
      p_salesman_id: context.salesmanId,
      p_business_date: input.businessDate,
      p_pickup_items: pickupPayload,
      p_sales_items: salesPayload,
    });

    if (error) {
      if (error.message.includes('permission_denied')) throw new DomainError("Permission denied.");
      if (error.message.includes('salesman_not_found')) throw new DomainError("Salesman not found.");
      if (error.message.includes('day_already_exists')) throw new DomainError("A day session already exists for this date.");
      if (error.message.includes('invalid_historical_date')) throw new DomainError("Historical date must be in the past.");
      if (error.message.includes('invalid_day_stock')) throw new DomainError("Invalid stock pickup payload.");
      if (error.message.includes('insufficient_daily_stock')) throw new DomainError("Cannot record sales: stock is insufficient.");
      if (error.message.includes('received_offer_conflict')) throw new DomainError("Cannot reconcile historical data: It would revoke an offer that has already been received. Please contact support.");
      
      console.error("RPC Error:", error);
      throw new DomainError("Failed to submit historical data.");
    }

    return { sessionId: String(data.id) };
  }

  async resetBusinessDay(sessionId: string): Promise<void> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);

    const { error } = await supabase.rpc("reset_day_atomic", {
      p_salesman_id: context.salesmanId,
      p_session_id: sessionId,
    });

    if (error) {
      console.error("Reset Day RPC Error:", error);
      throw new DomainError(error.message || "Failed to reset business day.");
    }
  }
}

export class SupabaseSaleRepository implements SaleRepository {
  async createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    
    const { data: duplicate } = await supabase.from('sales').select('id').eq('idempotency_key', input.idempotencyKey).maybeSingle();
    if (duplicate) return { saleId: String(duplicate.id), duplicate: true };

    const { data, error } = await supabase.rpc("create_sale_atomic", {
      p_salesman_id: context.salesmanId,
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
       if (error.message.includes('invalid_quantity')) throw new DomainError("Quantity must be a whole number between 1 and 999.", 400);
       if (error.message.includes('day_not_started')) throw new DomainError("Start the business day before recording sales.");
       if (error.message.includes('previous_day_still_open')) throw new DomainError(`The calendar date changed. Close the previous day before recording new sales.`);
       if (error.message.includes('product_not_picked') || error.message.includes('product_not_found')) throw new DomainError("This product is unavailable for the open day.", 404);
       if (error.message.includes('insufficient_daily_stock')) throw new DomainError("This sale exceeds the remaining stock.");
       throw new Error(`create_sale_atomic failed: ${error.message}`);
    }
    
    return { saleId: String(data.id),      duplicate: false,
    };
  }

  async returnSale(input: ReturnSaleInput): Promise<ReturnSaleResult> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data, error } = await supabase.rpc("reverse_sale_atomic", {
      p_salesman_id: context.salesmanId,
      p_sale_id: input.saleId,
      p_return_quantity: input.returnedQuantity,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });

    if (error) {
      if (error.message.includes('permission_denied')) throw new DomainError("Permission denied.");
      if (error.message.includes('sale_not_found')) throw new DomainError("Sale not found or already cancelled.", 404);
      if (error.message.includes('day_not_open')) throw new DomainError("Sale cannot be returned because the day session is closed.", 400);
      if (error.message.includes('exceeds_reversible_quantity')) throw new DomainError("Cannot return more than the reversible quantity.", 400);
      if (error.message.includes('offer_conflict')) throw new DomainError("Sale cannot be returned because it invalidates a RECEIVED offer.", 400);
      throw new Error(`reverse_sale_atomic failed: ${error.message}`);
    }

    return {
      returnId: data.id,
      returnedQuantity: input.returnedQuantity,
    };
  }

  async markOfferReceived(rewardId: string): Promise<void> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { error } = await supabase.rpc("mark_offer_received_atomic", {
      p_salesman_id: context.salesmanId,
      p_reward_id: rewardId,
    });

    if (error) {
      if (error.message.includes('reward_not_found')) throw new DomainError("Reward not found.", 404);
      if (error.message.includes('reward_void')) throw new DomainError("Reward is voided.", 400);
      throw new Error(`mark_offer_received_atomic failed: ${error.message}`);
    }
  }

  async undoOfferReceived(rewardId: string): Promise<void> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { error } = await supabase.rpc("undo_offer_received_atomic", {
      p_salesman_id: context.salesmanId,
      p_reward_id: rewardId,
    });

    if (error) {
      if (error.message.includes('reward_not_found')) throw new DomainError("Reward not found.", 404);
      if (error.message.includes('reward_void')) throw new DomainError("Reward is voided.", 400);
      throw new Error(`undo_offer_received_atomic failed: ${error.message}`);
    }
  }
}

function saleFromSupabaseRow(row: DbRow, returnsMap: Record<string, number> = {}): SaleRecord {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name_snapshot),
    quantity: Number(row.quantity),
    unitPricePaise: Number(row.unit_selling_price_paise),
    normalCommissionPaise: Number(row.normal_commission_paise_snapshot),
    fullCommissionPaise: Number(row.full_commission_paise_snapshot),
    rewardThreshold: Number(row.reward_threshold_snapshot),
    returnedQuantity: returnsMap[String(row.id)] || 0,
    normalUnits: Number(row.normal_commission_units),
    fullUnits: Number(row.full_commission_units),
    grossSalesPaise: Number(row.gross_sales_paise),
    totalNormalCommissionPaise: Number(row.total_normal_commission_paise),
    totalFullCommissionPaise: Number(row.total_full_commission_paise),
    totalEarningsPaise: Number(row.total_earnings_paise),
    netCollectionPaise: Number(row.net_collection_paise),
    finalProgress: 0,
    finalCycle: 0,
    fullCommissionCycles: [],
    createdAt: isoTimestamp(row.created_at),
  };
}

export class SupabaseStateRepository implements StateRepository {
  async getTrustedTime(): Promise<TrustedTimeState> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    const { data: settingsRow } = await supabase.from('app_settings').select('timezone').eq('company_id', context.companyId).maybeSingle();
    const timezone = String(settingsRow?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const time = await getDatabaseTime(timezone);
    return {
      serverTime: time.serverTimeIso,
      businessDate: time.businessDate,
      timezone,
    };
  }

  async getTrackerState(filter?: DateFilterOptions): Promise<TrackerState> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);
    
    const { data: settingsRow, error: settErr } = await supabase.from('app_settings').select('*').eq('company_id', context.companyId).maybeSingle();
    if (settErr) throw new Error(`Failed to fetch settings: ${settErr.message}`);

    const settings: AppSettings = {
      salesmanName: "", 
      businessName: String(settingsRow?.business_name ?? "AL QUWWA"),
      whatsappNumber: String(settingsRow?.whatsapp_report_number ?? ""),
      currency: String(settingsRow?.currency ?? "INR"),
      locale: String(settingsRow?.locale ?? "en-IN"),
      timezone: String(settingsRow?.timezone ?? DEFAULT_BUSINESS_TIMEZONE),
      realtimeEnabled: Boolean(settingsRow?.realtime_enabled ?? true),
    };
    
    const { data: salesmanData, error: sErr } = await supabase.from('salesmen').select('display_name').eq('id', context.salesmanId).maybeSingle();
    if (sErr) throw new Error(`Failed to fetch salesman: ${sErr.message}`);
    settings.salesmanName = String(salesmanData?.display_name ?? "Salesman");

    const time = await getDatabaseTime(settings.timezone);
    
    const { data: sessionsResult, error: sessErr } = await supabase.from('day_sessions').select('id, business_date, status').eq('salesman_id', context.salesmanId).order('business_date', { ascending: false });
    if (sessErr) throw new Error(`Failed to fetch sessions: ${sessErr.message}`);

    const sessions = (sessionsResult || []).map((row) => ({
      id: String(row.id),
      businessDate: String(row.business_date),
      status: String(row.status) as "OPEN" | "CLOSED",
    }));
    
    const decision = getCurrentBusinessDayStateUseCase(time.businessDate, sessions);
    const sessionId = decision.sessionId;

    const datedSession = sessionId
      ? (await supabase.from('day_sessions').select('*').eq('id', sessionId).single()).data
      : null;

    let daySession: DaySession | null = null;
    let sales: SaleRecord[] = [];
    let expenses: DayExpense[] = [];
    let dayCloseSnapshot: DayCloseSnapshot | null = null;

    if (datedSession) {
      const [stockRes, salesRes, reopenRes, snapshotRes, expensesRes, returnsRes, pickupLogsRes, pickupAdjRes] = await Promise.all([
        supabase.from('day_stock_items').select('*').eq('day_session_id', sessionId).order('product_name_snapshot'),
        supabase.from('sales').select('*').eq('day_session_id', sessionId).order('created_at', { ascending: false }).limit(100),
        supabase.from('day_reopens').select('*', { count: 'exact', head: true }).eq('day_session_id', sessionId),
        supabase.from('day_closures').select('*').eq('salesman_id', context.salesmanId).eq('business_date', datedSession.business_date).eq('status', 'ACTIVE').limit(1).maybeSingle(),
        supabase.from('day_expenses').select('*').eq('day_session_id', sessionId).order('created_at', { ascending: true }),
        supabase.from('sale_returns').select('sale_id, returned_quantity').eq('day_session_id', sessionId),
        supabase.from('audit_logs').select('*').eq('entity_id', sessionId).in('action', ['day.additional_pickup', 'day.started']).order('created_at', { ascending: true }),
        supabase.from('additional_pickup_adjustments').select('*').eq('day_session_id', sessionId)
      ]);
      
      const returnsMap = (returnsRes.data || []).reduce((map: Record<string, number>, row: DbRow) => {
        const sid = String(row.sale_id);
        map[sid] = (map[sid] || 0) + Number(row.returned_quantity);
        return map;
      }, {});

      // Process pickups
      const pickupAdjustments = pickupAdjRes.data || [];
      const pickups: import("../../application/contracts").AdditionalPickupRecord[] = [];
      
      (pickupLogsRes.data || []).forEach((logRow: any) => {
        const items = logRow.metadata?.items || [];
        items.forEach((item: any) => {
          const pid = String(item.product_id || item.productId);
          const originalQuantity = Number(item.additional_quantity || item.additionalQuantity || item.picked_quantity || item.pickedQuantity || 0);
          
          let effectiveQuantity = originalQuantity;
          let adjusted = false;
          
          pickupAdjustments.forEach((adjRow: any) => {
            if (adjRow.audit_log_id === logRow.id && adjRow.product_id === pid) {
              effectiveQuantity += Number(adjRow.adjustment_quantity);
              adjusted = true;
            }
          });
          
          const isInitial = logRow.action === 'day.started';
          const defaultReason = isInitial ? "ദിവസം തുടങ്ങിയപ്പോഴുള്ള സ്റ്റോക്ക്" : "";

          pickups.push({
            auditLogId: String(logRow.id),
            productId: pid,
            originalQuantity,
            effectiveQuantity,
            reason: String(logRow.metadata?.reason || defaultReason),
            createdAt: isoTimestamp(logRow.created_at),
            adjusted
          });
        });
      });

      sales = (salesRes.data || []).map(row => saleFromSupabaseRow(row, returnsMap));
      expenses = (expensesRes.data || []).map((row: DbRow) => ({
        id: String(row.id),
        daySessionId: String(row.day_session_id),
        category: String(row.category) as "Petrol" | "Food" | "Other",
        amountPaise: Number(row.amount_paise),
        description: row.description ? String(row.description) : undefined,
        createdAt: isoTimestamp(row.created_at),
      }));
      
      daySession = {
        id: sessionId as string,
        businessDate: String(datedSession.business_date),
        status: String(datedSession.status) as "OPEN" | "CLOSED",
        startedAt: isoTimestamp(datedSession.started_at),
        closedAt: datedSession.closed_at ? isoTimestamp(datedSession.closed_at) : null,
        reopenCount: Number(reopenRes.count ?? 0),
        expenses,
        pickups,
        stockItems: (stockRes.data || []).map((row: DbRow) => ({
          id: String(row.id),
          productId: String(row.product_id),
          productName: String(row.product_name_snapshot),
          unitPricePaise: Number(row.unit_price_paise_snapshot),
          pickedQuantity: Number(row.picked_quantity),
          soldQuantity: Number(row.sold_quantity),
          remainingQuantity: Number(row.remaining_quantity),
        })),
      };
      
      if (snapshotRes.data) {
        const snapshotRow = snapshotRes.data;
        dayCloseSnapshot = {
          id: String(snapshotRow.id),
          businessDate: String(snapshotRow.business_date),
          closureVersion: Number(snapshotRow.closure_version),
          status: String(snapshotRow.status) as "ACTIVE" | "SUPERSEDED",
          reportText: String(snapshotRow.report_text),
          totalExpensesPaise: Number(snapshotRow.total_expenses_paise || 0),
          whatsappReportStatus: String(snapshotRow.whatsapp_report_status) as "CURRENT" | "OUTDATED",
          createdAt: isoTimestamp(snapshotRow.created_at),
        };
      }
    }

    let historyQuery = supabase.from('sales').select('*, day_sessions!inner(business_date)').eq('salesman_id', context.salesmanId);
    let closuresQuery = supabase.from('day_closures').select('*').eq('salesman_id', context.salesmanId).eq('status', 'ACTIVE');
    let rewardsQuery = supabase.from('full_commission_rewards').select('*, sales!inner(day_sessions!inner(business_date))').eq('salesman_id', context.salesmanId);

    if (filter?.startDate) {
      closuresQuery = closuresQuery.gte('business_date', filter.startDate);
      historyQuery = historyQuery.gte('day_sessions.business_date', filter.startDate);
      rewardsQuery = rewardsQuery.gte('sales.day_sessions.business_date', filter.startDate);
    }
    if (filter?.endDate) {
      closuresQuery = closuresQuery.lte('business_date', filter.endDate);
      historyQuery = historyQuery.lte('day_sessions.business_date', filter.endDate);
      rewardsQuery = rewardsQuery.lte('sales.day_sessions.business_date', filter.endDate);
    }
    if (filter?.productId) {
      historyQuery = historyQuery.eq('product_id', filter.productId);
      rewardsQuery = rewardsQuery.eq('product_id', filter.productId);
    }
    if (filter?.status && filter.status !== 'ALL') {
      rewardsQuery = rewardsQuery.eq('status', filter.status.toLowerCase());
    }

    const usePagination = filter?.page != null && filter?.pageSize != null && filter.page > 0 && filter.pageSize > 0;
    const pageFrom = usePagination ? (filter.page! - 1) * filter.pageSize! : 0;
    const pageTo = usePagination ? pageFrom + filter.pageSize! - 1 : 0;

    if (usePagination) {
      historyQuery = historyQuery.range(pageFrom, pageTo);
      rewardsQuery = rewardsQuery.range(pageFrom, pageTo);
      closuresQuery = closuresQuery.range(pageFrom, pageTo);
    } else {
      historyQuery = historyQuery.limit(250);
      rewardsQuery = rewardsQuery.limit(250);
      closuresQuery = closuresQuery.limit(100);
    }

    // Count queries (with same filters, no pagination/range)
    const historyCountQuery = supabase.from('sales').select('*, day_sessions!inner(business_date)', { count: 'exact', head: true }).eq('salesman_id', context.salesmanId);
    const closuresCountQuery = supabase.from('day_closures').select('*', { count: 'exact', head: true }).eq('salesman_id', context.salesmanId).eq('status', 'ACTIVE');
    const rewardsCountQuery = supabase.from('full_commission_rewards').select('*, sales!inner(day_sessions!inner(business_date))', { count: 'exact', head: true }).eq('salesman_id', context.salesmanId);

    if (filter?.startDate) {
      historyCountQuery.gte('day_sessions.business_date', filter.startDate);
      closuresCountQuery.gte('business_date', filter.startDate);
      rewardsCountQuery.gte('sales.day_sessions.business_date', filter.startDate);
    }
    if (filter?.endDate) {
      historyCountQuery.lte('day_sessions.business_date', filter.endDate);
      closuresCountQuery.lte('business_date', filter.endDate);
      rewardsCountQuery.lte('sales.day_sessions.business_date', filter.endDate);
    }
    if (filter?.productId) {
      historyCountQuery.eq('product_id', filter.productId);
      rewardsCountQuery.eq('product_id', filter.productId);
    }
    if (filter?.status && filter.status !== 'ALL') {
      rewardsCountQuery.eq('status', filter.status.toLowerCase());
    }

    const [productsRes, historyRes, closuresRes, rewardsRes, historyCountRes, closuresCountRes, rewardsCountRes] = await Promise.all([
      supabase.from('products')
        .select('id, name, selling_price_paise, commission_rules(normal_commission_paise, full_commission_paise, reward_threshold), commission_progress(normal_sales_completed, cycle_number)')
        .eq('active', true)
        .order('sort_order'),
      historyQuery.order('created_at', { ascending: false }),
      closuresQuery.order('business_date', { ascending: false }),
      rewardsQuery.order('created_at', { ascending: false }),
      historyCountQuery,
      closuresCountQuery,
      rewardsCountQuery,
    ]);

    let filteredDashboard: DashboardSummary | undefined;
    if (filter?.startDate || filter?.endDate || filter?.productId) {
      let filteredSalesQuery = supabase.from('sales')
        .select('*, day_sessions!inner(business_date)')
        .eq('salesman_id', context.salesmanId);
      if (filter.startDate) filteredSalesQuery = filteredSalesQuery.gte('day_sessions.business_date', filter.startDate);
      if (filter.endDate) filteredSalesQuery = filteredSalesQuery.lte('day_sessions.business_date', filter.endDate);
      if (filter.productId) filteredSalesQuery = filteredSalesQuery.eq('product_id', filter.productId);

      let filteredExpensesQuery = supabase.from('day_expenses')
        .select('*, day_sessions!inner(business_date)')
        .eq('company_id', context.companyId);
      if (filter.startDate) filteredExpensesQuery = filteredExpensesQuery.gte('day_sessions.business_date', filter.startDate);
      if (filter.endDate) filteredExpensesQuery = filteredExpensesQuery.lte('day_sessions.business_date', filter.endDate);

      const [filteredSalesRes, filteredExpensesRes] = await Promise.all([filteredSalesQuery, filteredExpensesQuery]);
      const filteredSales = (filteredSalesRes.data || []).map((row: DbRow) => saleFromSupabaseRow(row));
      const filteredExpensesTotal = (filteredExpensesRes.data || []).reduce((sum, row) => sum + Number(row.amount_paise || 0), 0);
      filteredDashboard = summarizeSales(filteredSales, filteredExpensesTotal);
    }
    
    const rewards = (rewardsRes.data || []).map((row: DbRow) => ({
      id: String(row.id),
      saleId: String(row.sale_id),
      productId: String(row.product_id),
      productName: String(row.product_name_snapshot || "Offer Reward"),
      cycleNumber: Number(row.cycle_number),
      amountPaise: Number(row.amount_paise),
      createdAt: isoTimestamp(row.created_at),
      receivedAt: row.received_at ? isoTimestamp(row.received_at) : null,
      status: String(row.status || 'EARNED').toUpperCase() as "EARNED" | "RECEIVED",
    })) as FullCommissionReward[];
    
    const historySales = (historyRes.data || []).map((row: DbRow) => ({
      ...saleFromSupabaseRow(row),
      businessDate: String((row.day_sessions as DbRow)?.business_date),
    }));

    const historyClosures = (closuresRes.data || []).map((row: DbRow) => ({
      id: String(row.id),
      businessDate: String(row.business_date),
      closureVersion: Number(row.closure_version || 1),
      status: String(row.status || 'ACTIVE') as "ACTIVE" | "SUPERSEDED",
      reportText: String(row.report_text || ""),
      totalExpensesPaise: Number(row.total_expenses_paise || 0),
      whatsappReportStatus: String(row.whatsapp_report_status || 'CURRENT') as "CURRENT" | "OUTDATED",
      createdAt: isoTimestamp(row.created_at),
    }));

    const statusMap = {
      NEW_DAY: "NOT_STARTED",
      CURRENT_OPEN: "OPEN",
      CURRENT_CLOSED: "CLOSED",
      PREVIOUS_OPEN: "PREVIOUS_DAY_STILL_OPEN",
    } as const;

    const daySessionStatus = statusMap[decision.openingState];
    const laterSessionExists = daySession ? sessions.some(s => s.businessDate > daySession!.businessDate) : false;
    
    const reopenEligibility = daySession
      ? reopenBusinessDayUseCase({
          trustedBusinessDate: time.businessDate,
          target: daySession,
          laterSessionExists,
          hasPermission: true,
        })
      : { allowed: false, reason: "No closed Business Day is available." };

    const totalExpensesPaise = expenses.reduce((sum, e) => sum + e.amountPaise, 0);

    return {
      settings,
      time: {
        serverTime: time.serverTimeIso,
        businessDate: time.businessDate,
        timezone: time.timezone,
      },
      products: (productsRes.data || []).map((row: DbRow) => {
         const cp = Array.isArray(row.commission_progress) ? row.commission_progress[0] : null;
         const rule = Array.isArray(row.commission_rules) ? row.commission_rules[0] : (row.commission_rules as DbRow | null);
         return {
          id: String(row.id),
          name: String(row.name),
          sellingPricePaise: Number(row.selling_price_paise),
          normalCommissionPaise: Number(rule?.normal_commission_paise ?? 0),
          fullCommissionPaise: Number(rule?.full_commission_paise ?? 0),
          rewardThreshold: Number(rule?.reward_threshold ?? 12),
          progress: Number(cp?.normal_sales_completed ?? 0),
          cycleNumber: Number(cp?.cycle_number ?? 1),
         };
      }),
      dashboard: summarizeSales(sales, totalExpensesPaise),
      isDayClosed: daySessionStatus === "CLOSED",
      daySession,
      daySessionStatus,
      openingState: decision.openingState,
      sales,
      dayCloseSnapshot,
      filteredDashboard,
      historySales,
      historySalesCount: historyCountRes.count ?? historySales.length,
      historyClosures,
      historyClosuresCount: closuresCountRes.count ?? historyClosures.length,
      rewards,
      rewardsCount: rewardsCountRes.count ?? rewards.length,
      expenses,
      reopenEligibility,
      resetEligibility: daySession
        ? canResetBusinessDayUseCase({
          target: daySession,
          laterSessionExists,
          hasPermission: true,
        })
        : { allowed: false, reason: "No closed Business Day is available." },
      lastUpdatedAt: time.serverTimeIso,
    };
  }
}

export class SupabaseExpenseRepository implements ExpenseRepository {
  async addExpense(input: CreateExpenseInput): Promise<DayExpense> {
    const supabase = createAdminClient();
    const context = await getActiveContext(supabase);

    const { data: session, error: sessErr } = await supabase
      .from('day_sessions')
      .select('status')
      .eq('id', input.sessionId)
      .single();

    if (sessErr || !session) throw new DomainError("Business day session not found.", 404);
    if (session.status !== 'OPEN') throw new DomainError("Expenses can only be added to an active business day.");

    const { data, error } = await supabase
      .from('day_expenses')
      .insert({
        tenant_id: context.tenantId,
        company_id: context.companyId,
        salesman_id: context.salesmanId,
        day_session_id: input.sessionId,
        category: input.category,
        amount_paise: input.amountPaise,
        description: input.description || null,
      })
      .select('*')
      .single();

    if (error || !data) throw new DomainError(`Failed to add expense: ${error?.message || "Unknown error"}`);

    return {
      id: String(data.id),
      daySessionId: String(data.day_session_id),
      category: String(data.category) as "Petrol" | "Food" | "Other",
      amountPaise: Number(data.amount_paise),
      description: data.description ? String(data.description) : undefined,
      createdAt: isoTimestamp(data.created_at),
    };
  }

  async updateExpense(expenseId: string, input: { amountPaise?: number; description?: string }): Promise<DayExpense> {
    const supabase = createAdminClient();
    
    const updateData: DbRow = {};
    if (input.amountPaise !== undefined) updateData.amount_paise = input.amountPaise;
    if (input.description !== undefined) updateData.description = input.description || null;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('day_expenses')
      .update(updateData)
      .eq('id', expenseId)
      .select('*')
      .single();

    if (error || !data) throw new DomainError(`Failed to update expense: ${error?.message || "Unknown error"}`);

    return {
      id: String(data.id),
      daySessionId: String(data.day_session_id),
      category: String(data.category) as "Petrol" | "Food" | "Other",
      amountPaise: Number(data.amount_paise),
      description: data.description ? String(data.description) : undefined,
      createdAt: isoTimestamp(data.created_at),
    };
  }

  async deleteExpense(expenseId: string): Promise<void> {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from('day_expenses')
      .delete()
      .eq('id', expenseId);

    if (error) throw new DomainError(`Failed to delete expense: ${error.message}`);
  }

  async getExpenses(sessionId: string): Promise<DayExpense[]> {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('day_expenses')
      .select('*')
      .eq('day_session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) throw new DomainError(`Failed to fetch expenses: ${error.message}`);

    return (data || []).map((row: DbRow) => ({
      id: String(row.id),
      daySessionId: String(row.day_session_id),
      category: String(row.category) as "Petrol" | "Food" | "Other",
      amountPaise: Number(row.amount_paise),
      description: row.description ? String(row.description) : undefined,
      createdAt: isoTimestamp(row.created_at),
    }));
  }
}


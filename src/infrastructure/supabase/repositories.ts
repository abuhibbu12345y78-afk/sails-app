import { createAdminClient } from "./client";
import {
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
  CreateSaleResult
} from "../../application/repositories";
import {
  TrackerState,
  DaySession,
  SaleRecord,
  DayCloseSnapshot,
  AppSettings,
  TrustedTimeState,
  FullCommissionReward
} from "../../application/contracts";
import { DomainError } from "../../application/errors";
import { parseDatabaseTimestamp } from "./client";
import { getActiveContext } from "./context";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../domain/business-time";
import { summarizeSales } from "../../application/summary";
import { getCurrentBusinessDayStateUseCase, reopenBusinessDayUseCase, canResetBusinessDayUseCase } from "../../application/business-day-use-cases";

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

    // Verify session exists and belongs to the salesman
    const { data: session, error: sessErr } = await supabase
      .from('day_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('salesman_id', context.salesmanId)
      .single();
      
    if (sessErr || !session) {
      throw new DomainError("The Business Day could not be found.", 404);
    }

    // Check for newer sessions
    const { data: laterSession } = await supabase
      .from('day_sessions')
      .select('id')
      .eq('salesman_id', context.salesmanId)
      .gt('business_date', session.business_date)
      .limit(1);

    if (laterSession && laterSession.length > 0) {
      throw new DomainError("Cannot reset a day because a newer session already exists.");
    }

    // Perform deletions in correct dependency order based on actual Supabase schema
    // 1. Find and delete sales associated with this day session
    const { data: sales } = await supabase
      .from('sales')
      .select('id')
      .eq('day_session_id', sessionId);

    if (sales && sales.length > 0) {
      const saleIds = sales.map((s: { id: unknown }) => String(s.id));
      await supabase.from('full_commission_rewards').delete().in('sale_id', saleIds);
      await supabase.from('sales').delete().in('id', saleIds);
    }

    // 2. Delete stock items, reopens, and closures
    await supabase.from('day_stock_items').delete().eq('day_session_id', sessionId);
    await supabase.from('day_reopens').delete().eq('day_session_id', sessionId);
    await supabase.from('day_closures').delete().eq('salesman_id', context.salesmanId).eq('business_date', session.business_date);
    
    // 3. Delete the day session itself
    const { error: deleteErr } = await supabase.from('day_sessions').delete().eq('id', sessionId);
    if (deleteErr) {
      throw new Error(`Failed to delete day session: ${deleteErr.message}`);
    }

    // 4. Log the audit event matching live audit_logs columns
    await supabase.from('audit_logs').insert({
      tenant_id: context.tenantId,
      company_id: context.companyId,
      actor_id: context.salesmanId,
      action: 'day.reset',
      entity_type: 'day_session',
      entity_id: sessionId,
      metadata: { businessDate: session.business_date }
    });
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
    
    return { saleId: String(data.id), duplicate: false };
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
}

function saleFromSupabaseRow(row: DbRow): SaleRecord {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name_snapshot),
    quantity: Number(row.quantity),
    unitPricePaise: Number(row.unit_selling_price_paise),
    normalCommissionPaise: Number(row.normal_commission_paise_snapshot),
    fullCommissionPaise: Number(row.full_commission_paise_snapshot),
    rewardThreshold: Number(row.reward_threshold_snapshot),
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

  async getTrackerState(): Promise<TrackerState> {
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
    let rewards: Array<FullCommissionReward> = [];
    let dayCloseSnapshot: DayCloseSnapshot | null = null;

    if (datedSession) {
      const [stockRes, salesRes, rewardsRes, reopenRes, snapshotRes] = await Promise.all([
        supabase.from('day_stock_items').select('*').eq('day_session_id', sessionId).order('product_name_snapshot'),
        supabase.from('sales').select('*').eq('day_session_id', sessionId).order('created_at', { ascending: false }).limit(100),
        supabase.from('full_commission_rewards').select('*, sales!inner(day_session_id)').eq('sales.day_session_id', sessionId).order('created_at', { ascending: false }).limit(100),
        supabase.from('day_reopens').select('*', { count: 'exact', head: true }).eq('day_session_id', sessionId),
        supabase.from('day_closures').select('*').eq('salesman_id', context.salesmanId).eq('business_date', datedSession.business_date).eq('status', 'ACTIVE').limit(1).maybeSingle(),
      ]);
      
      sales = (salesRes.data || []).map(saleFromSupabaseRow);
      rewards = (rewardsRes.data || []).map((row: DbRow) => ({
        id: String(row.id),
        saleId: String(row.sale_id),
        productName: String(row.product_name),
        cycleNumber: Number(row.cycle_number),
        amountPaise: Number(row.amount_paise),
        createdAt: isoTimestamp(row.created_at),
        status: String(row.status || 'EARNED').toUpperCase() as "EARNED" | "RECEIVED",
      })) as FullCommissionReward[];
      
      daySession = {
        id: sessionId as string,
        businessDate: String(datedSession.business_date),
        status: String(datedSession.status) as "OPEN" | "CLOSED",
        startedAt: isoTimestamp(datedSession.started_at),
        closedAt: datedSession.closed_at ? isoTimestamp(datedSession.closed_at) : null,
        reopenCount: Number(reopenRes.count ?? 0),
        expenses: [],
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
          whatsappReportStatus: String(snapshotRow.whatsapp_report_status) as "CURRENT" | "OUTDATED",
          createdAt: isoTimestamp(snapshotRow.created_at),
        };
      }
    }

    const [productsRes, historyRes] = await Promise.all([
      supabase.from('products')
        .select('id, name, selling_price_paise, commission_rules(normal_commission_paise, full_commission_paise, reward_threshold), commission_progress(normal_sales_completed, cycle_number)')
        .eq('active', true)
        .order('sort_order'),
      supabase.from('sales').select('*, day_sessions!inner(business_date)').eq('salesman_id', context.salesmanId).order('created_at', { ascending: false }).limit(250),
    ]);
    
    const historySales = (historyRes.data || []).map((row: DbRow) => ({
      ...saleFromSupabaseRow(row),
      businessDate: String((row.day_sessions as DbRow)?.business_date),
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
      dashboard: summarizeSales(sales),
      isDayClosed: daySessionStatus === "CLOSED",
      daySession,
      daySessionStatus,
      openingState: decision.openingState,
      sales,
      rewards,
      dayCloseSnapshot,
      historySales,
      expenses: [],
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

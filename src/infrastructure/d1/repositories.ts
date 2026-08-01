import { ensureDatabase, getDatabaseTime, parseDatabaseTimestamp } from "./database";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../domain/business-time";
import { DomainError } from "../../application/errors";
import {
  AdditionalPickupInput,
  AdditionalPickupResult,
  CloseDayResult,
  CreateSaleInput,
  CreateSaleResult,
  DaySessionRepository,
  HistoricalDataInput,
  HistoricalDataResult,
  ReopenDayInput,
  ReopenDayResult,
  SaleRepository,
  SettingsRepository,
  StartDayInput,
  StartDayResult,
  StateRepository,
} from "../../application/repositories";
import type { AppSettings, DateFilterOptions, DayCloseSnapshot, DaySession, DaySessionStatus, DayStockItem, SaleRecord, TrackerState, TrustedTimeState } from "../../application/contracts";
import { calculateSale, formatCurrency } from "../../domain/commission";
import { validateDailySale } from "../../domain/day-session";
import { getCurrentBusinessDayStateUseCase, reopenBusinessDayUseCase, previewAdditionalPickupUseCase, canResetBusinessDayUseCase } from "../../application/business-day-use-cases";
import { summarizeSales } from "../../application/summary";

type Row = Record<string, string | number | null>;

function isoTimestamp(value: unknown) {
  return parseDatabaseTimestamp(String(value)).toISOString();
}

function saleFromRow(row: Row): SaleRecord {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    unitPricePaise: Number(row.unit_price_paise),
    normalCommissionPaise: Number(row.normal_commission_paise),
    fullCommissionPaise: Number(row.full_commission_paise),
    rewardThreshold: Number(row.reward_threshold),
    normalUnits: Number(row.normal_units),
    fullUnits: Number(row.full_units),
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

export class D1DaySessionRepository implements DaySessionRepository {
  async startDaySession(input: StartDayInput): Promise<StartDayResult> {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const openSession = await db.prepare("SELECT business_date FROM day_sessions WHERE status = 'OPEN' LIMIT 1").first<Row>();
    if (openSession) {
      throw new DomainError(
        String(openSession.business_date) < time.businessDate
          ? `Close ${openSession.business_date} before starting ${time.businessDate}.`
          : "The business day is already open."
      );
    }
    const existing = await db.prepare("SELECT status FROM day_sessions WHERE business_date = ?").bind(time.businessDate).first<Row>();
    if (existing) throw new DomainError("This business date has already been started.");

    const productResult = await db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY sort_order").all<Row>();
    const quantities = new Map(input.items.map((item) => [item.productId, item.pickedQuantity]));
    const validIds = new Set(productResult.results.map((row) => String(row.id)));
    if (input.items.some((item) => !validIds.has(item.productId))) {
      throw new DomainError("One or more selected products are unavailable.", 400);
    }

    const sessionId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO day_sessions (id, business_date, status, started_at) VALUES (?, ?, 'OPEN', CURRENT_TIMESTAMP)")
        .bind(sessionId, time.businessDate),
      db.prepare(`INSERT INTO day_session_scopes
        (day_session_id, tenant_id, company_id, salesman_id, business_date)
        VALUES (?, 'default', 'default', 'default', ?)`).bind(sessionId, time.businessDate),
      ...productResult.results.map((product) => {
        const picked = quantities.get(String(product.id)) ?? 0;
        return db.prepare(`INSERT INTO day_stock_items
          (id, day_session_id, product_id, picked_quantity, sold_quantity, remaining_quantity,
           product_name_snapshot, unit_price_paise_snapshot)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?)`)
          .bind(crypto.randomUUID(), sessionId, product.id, picked, picked, product.name, product.selling_price_paise);
      }),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.started', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, JSON.stringify({ businessDate: time.businessDate })),
    ]);
    const created = await db.prepare("SELECT started_at FROM day_sessions WHERE id = ?").bind(sessionId).first<Row>();
    if (!created?.started_at) throw new Error("Server-confirmed Day Start time is unavailable.");
    const startedAt = parseDatabaseTimestamp(String(created?.started_at)).toISOString();
    return { id: sessionId, businessDate: time.businessDate, startedAt };
  }

  async closeDaySession(sessionId: string): Promise<CloseDayResult> {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const time = await getDatabaseTime(String(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE));
    const session = await db.prepare(
      "SELECT * FROM day_sessions WHERE id = ? AND status = 'OPEN'"
    ).bind(sessionId).first<Row>();
    if (!session) throw new DomainError("There is no open business day to close.");

    const [totals, stockRows, versionRow] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(s.quantity),0) total_units,
        COALESCE(SUM(s.gross_sales_paise),0) gross,
        COALESCE(SUM(s.total_normal_commission_paise),0) normal,
        COALESCE(SUM(s.total_full_commission_paise),0) full_commission,
        COALESCE(SUM(s.total_earnings_paise),0) earnings,
        COALESCE(SUM(s.net_collection_paise),0) net
        FROM sales s JOIN day_session_sales dss ON dss.sale_id = s.id
        WHERE dss.day_session_id = ?`).bind(sessionId).first<Row>(),
      db.prepare(`SELECT product_name_snapshot, picked_quantity, sold_quantity, remaining_quantity
        FROM day_stock_items WHERE day_session_id = ? ORDER BY product_name_snapshot`).bind(sessionId).all<Row>(),
      db.prepare(`SELECT COALESCE(MAX(closure_version), 0) AS closure_version
        FROM day_close_snapshots WHERE day_session_id = ?`).bind(sessionId).first<Row>(),
    ]);
    const closureVersion = Number(versionRow?.closure_version ?? 0) + 1;

    const reportText = [
      "AL QUWWA — Business Day Summary",
      "",
      `Date: ${session.business_date}`,
      "",
      "Product-wise Stock",
      ...stockRows.results.map((row: Row) =>
        `• ${row.product_name_snapshot} — Picked ${row.picked_quantity}, Sold ${row.sold_quantity}, Remaining ${row.remaining_quantity}`
      ),
      "",
      `Gross Sales: ${formatCurrency(Number(totals?.gross ?? 0))}`,
      `Normal Commission: ${formatCurrency(Number(totals?.normal ?? 0))}`,
      `Offers Earned: ${formatCurrency(Number(totals?.full_commission ?? 0))}`,
      `Total Earnings: ${formatCurrency(Number(totals?.earnings ?? 0))}`,
      `Net Collection: ${formatCurrency(Number(totals?.net ?? 0))}`,
    ].join("\n");
    const closureId = crypto.randomUUID();
    const snapshot = {
      businessDate: String(session.business_date),
      startedAt: parseDatabaseTimestamp(String(session.started_at)).toISOString(),
      closedAt: time.serverTimeIso,
      closureVersion,
      stockItems: stockRows.results.map((row: Row) => ({
        productName: String(row.product_name_snapshot),
        pickedQuantity: Number(row.picked_quantity),
        soldQuantity: Number(row.sold_quantity),
        remainingQuantity: Number(row.remaining_quantity),
      })),
      totalUnits: Number(totals?.total_units ?? 0),
      grossSalesPaise: Number(totals?.gross ?? 0),
      totalNormalCommissionPaise: Number(totals?.normal ?? 0),
      totalOfferEarningsPaise: Number(totals?.full_commission ?? 0),
      totalEarningsPaise: Number(totals?.earnings ?? 0),
      netCollectionPaise: Number(totals?.net ?? 0),
    };

    await db.batch([
      db.prepare(`UPDATE day_close_snapshots
        SET status = 'SUPERSEDED', whatsapp_report_status = 'OUTDATED'
        WHERE day_session_id = ? AND status = 'ACTIVE'`).bind(sessionId),
      db.prepare(`UPDATE day_sessions
        SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'OPEN'`).bind(sessionId),
      db.prepare(`INSERT INTO day_close_snapshots
        (id, day_session_id, business_date, closure_version, status, total_units, gross_sales_paise,
        total_normal_commission_paise, total_offer_earnings_paise, total_earnings_paise,
        net_collection_paise, snapshot_json, report_text, whatsapp_report_status)
        VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT')`)
        .bind(closureId, sessionId, session.business_date, closureVersion,
          snapshot.totalUnits, snapshot.grossSalesPaise, snapshot.totalNormalCommissionPaise,
          snapshot.totalOfferEarningsPaise, snapshot.totalEarningsPaise, snapshot.netCollectionPaise,
          JSON.stringify(snapshot), reportText),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.closed', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, JSON.stringify({
          businessDate: session.business_date,
          serverTime: time.serverTimeIso,
          closureVersion,
        })),
    ]);
    const closed = await db.prepare("SELECT closed_at FROM day_sessions WHERE id = ?").bind(sessionId).first<Row>();
    if (!closed?.closed_at) throw new Error("Server-confirmed closing time is unavailable.");
    const closedAt = parseDatabaseTimestamp(String(closed?.closed_at)).toISOString();
    return {
      id: closureId,
      reportText,
      whatsappNumber: String(settings?.whatsapp_number ?? ""),
      closedAt,
      businessDate: String(session.business_date),
      closureVersion,
    };
  }

  async reopenDaySession(input: ReopenDayInput): Promise<ReopenDayResult> {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(input.sessionId).first<Row>();
    if (!session) throw new DomainError("The Business Day could not be found.", 404);

    const [later, otherOpen, countRow] = await Promise.all([
      db.prepare("SELECT id FROM day_sessions WHERE business_date > ? LIMIT 1").bind(session.business_date).first<Row>(),
      db.prepare("SELECT id FROM day_sessions WHERE status = 'OPEN' AND id <> ? LIMIT 1").bind(input.sessionId).first<Row>(),
      db.prepare("SELECT COUNT(*) AS reopen_count FROM day_reopens WHERE day_session_id = ?").bind(input.sessionId).first<Row>(),
    ]);
    const eligibility = reopenBusinessDayUseCase({
      trustedBusinessDate: time.businessDate,
      target: {
        id: input.sessionId,
        businessDate: String(session.business_date),
        status: String(session.status) as "OPEN" | "CLOSED",
      },
      laterSessionExists: Boolean(later),
      hasPermission: true,
    });
    if (!eligibility.allowed) throw new DomainError(eligibility.reason ?? "Cannot reopen.");
    if (otherOpen) throw new DomainError("Another Business Day is already open.");
    if (!session.closed_at) throw new DomainError("The original closing time is unavailable.");

    const reopenCount = Number(countRow?.reopen_count ?? 0) + 1;
    const reopenId = crypto.randomUUID();
    await db.batch([
      db.prepare(`UPDATE day_sessions SET status = 'OPEN', closed_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'CLOSED'`).bind(input.sessionId),
      db.prepare(`UPDATE day_close_snapshots
        SET status = 'SUPERSEDED', whatsapp_report_status = 'OUTDATED'
        WHERE day_session_id = ? AND status = 'ACTIVE'`).bind(input.sessionId),
      db.prepare(`INSERT INTO day_reopens
        (id, day_session_id, reopen_count, reopen_reason, reopened_by, original_closed_at)
        VALUES (?, ?, ?, ?, 'owner', ?)`)
        .bind(reopenId, input.sessionId, reopenCount, input.reason, session.closed_at),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.reopened', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), input.sessionId, JSON.stringify({
          businessDate: session.business_date,
          reason: input.reason,
          reopenCount,
          serverTime: time.serverTimeIso,
        })),
    ]);
    const reopened = await db.prepare("SELECT updated_at FROM day_sessions WHERE id = ? AND status = 'OPEN'")
      .bind(input.sessionId).first<Row>();
    if (!reopened?.updated_at) throw new DomainError("The Business Day state changed. Refresh and try again.");
    return {
      sessionId: input.sessionId,
      reopenCount,
      reopenedAt: parseDatabaseTimestamp(String(reopened.updated_at)).toISOString(),
    };
  }

  async additionalPickup(input: AdditionalPickupInput): Promise<AdditionalPickupResult> {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(input.sessionId).first<Row>();
    if (!session || session.status !== "OPEN") {
      throw new DomainError("The reopened Business Day is no longer open.");
    }
    if (String(session.business_date) !== time.businessDate) {
      throw new DomainError("Additional pickup is allowed only for the trusted current Business Date.");
    }
    const reopened = await db.prepare("SELECT id FROM day_reopens WHERE day_session_id = ? ORDER BY reopen_count DESC LIMIT 1")
      .bind(input.sessionId).first<Row>();
    if (!reopened) throw new DomainError("Reopen the current Business Day before adding pickup.");

    const stockResult = await db.prepare(`SELECT dsi.*, p.active FROM day_stock_items dsi
      JOIN products p ON p.id = dsi.product_id WHERE dsi.day_session_id = ?`)
      .bind(input.sessionId).all<Row>();
    const stockItems: DayStockItem[] = stockResult.results.map((row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      productName: String(row.product_name_snapshot),
      unitPricePaise: Number(row.unit_price_paise_snapshot),
      pickedQuantity: Number(row.picked_quantity),
      soldQuantity: Number(row.sold_quantity),
      remainingQuantity: Number(row.remaining_quantity),
    }));
    const activeIds = new Set(stockResult.results.filter((row) => Number(row.active) === 1).map((row) => String(row.product_id)));
    if (input.items.some((item) => item.additionalQuantity > 0 && !activeIds.has(item.productId))) {
      throw new DomainError("One or more products are unavailable.", 400);
    }
    const preview = previewAdditionalPickupUseCase(stockItems, input.items);
    if (preview.totalAdditionalUnits < 1) {
      throw new DomainError("Choose at least one additional unit.", 400);
    }

    await db.batch([
      ...preview.items.flatMap((item) => [
        db.prepare(`UPDATE day_stock_items
          SET picked_quantity = ?, remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE day_session_id = ? AND product_id = ? AND picked_quantity = ? AND remaining_quantity = ?`)
          .bind(item.newPickedQuantity, item.newRemainingQuantity, input.sessionId, item.productId,
            item.previousPickedQuantity, item.previousRemainingQuantity),
        db.prepare(`INSERT INTO day_stock_adjustments
          (id, day_session_id, product_id, adjustment_type, quantity,
          previous_picked_quantity, new_picked_quantity, previous_remaining_quantity,
          new_remaining_quantity, reason, created_by)
          VALUES (?, ?, ?, 'ADDITIONAL_PICKUP', ?, ?, ?, ?, ?, ?, 'owner')`)
          .bind(crypto.randomUUID(), input.sessionId, item.productId, item.additionalQuantity,
            item.previousPickedQuantity, item.newPickedQuantity, item.previousRemainingQuantity,
            item.newRemainingQuantity, input.reason),
      ]),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'stock.additional_pickup', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), input.sessionId, JSON.stringify({
          totalAdditionalUnits: preview.totalAdditionalUnits,
          items: preview.items,
          reason: input.reason,
          serverTime: time.serverTimeIso,
        })),
    ]);
    return {
      sessionId: input.sessionId,
      totalAdditionalUnits: preview.totalAdditionalUnits,
      items: preview.items,
      createdAt: new Date().toISOString(),
    };
  }

  async submitHistoricalData(_input: HistoricalDataInput): Promise<HistoricalDataResult> {
    throw new Error("Historical data entry is not currently supported on SQLite/D1. Please use Supabase.");
  }

  async resetBusinessDay(sessionId: string): Promise<void> {
    const db = await ensureDatabase();
    const session = await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(sessionId).first<Row>();
    if (!session) throw new DomainError("The Business Day could not be found.", 404);

    const [later, countRow] = await Promise.all([
      db.prepare("SELECT id FROM day_sessions WHERE business_date > ? LIMIT 1").bind(session.business_date).first<Row>(),
      db.prepare("SELECT COUNT(*) as count FROM day_session_sales WHERE day_session_id = ?").bind(sessionId).first<Row>(),
    ]);
    
    // We can allow reset if no sales are made. If there are sales, we delete them too? 
    // The user requested a complete wipe. We should delete everything cascadingly.
    // In SQLite/D1 we'll delete explicitly if no ON DELETE CASCADE is set.
    
    await db.batch([
      db.prepare("DELETE FROM day_session_sales WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM sales WHERE id IN (SELECT sale_id FROM day_session_sales WHERE day_session_id = ?)").bind(sessionId),
      db.prepare("DELETE FROM day_stock_items WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_stock_adjustments WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_reopens WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_close_snapshots WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_closures WHERE business_date = ?").bind(session.business_date),
      db.prepare("DELETE FROM day_expenses WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_session_scopes WHERE day_session_id = ?").bind(sessionId),
      db.prepare("DELETE FROM day_sessions WHERE id = ?").bind(sessionId),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.reset', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, JSON.stringify({ businessDate: session.business_date })),
    ]);
  }
}

export class D1SaleRepository implements SaleRepository {
  async createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
    const db = await ensureDatabase();
    const duplicate = await db.prepare("SELECT id FROM sales WHERE idempotency_key = ?").bind(input.idempotencyKey).first<Row>();
    if (duplicate) return { saleId: String(duplicate.id), duplicate: true };

    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE status = 'OPEN' LIMIT 1").first<Row>();
    if (!session) throw new DomainError("Start the business day before recording sales.");
    if (String(session.business_date) !== time.businessDate) {
      throw new DomainError(`The calendar date changed. Close ${session.business_date} before recording new sales.`);
    }

    const row = await db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number,
      dsi.picked_quantity, dsi.sold_quantity, dsi.remaining_quantity, dsi.id AS stock_item_id
      FROM products p
      JOIN commission_progress cp ON cp.product_id = p.id
      JOIN day_stock_items dsi ON dsi.product_id = p.id AND dsi.day_session_id = ?
      WHERE p.id = ? AND p.active = 1`)
      .bind(session.id, input.productId).first<Row>();
    if (!row) throw new DomainError("This product is unavailable for the open day.", 404);
    
    try {
      validateDailySale({
        productId: input.productId,
        pickedQuantity: Number(row.picked_quantity),
        soldQuantity: Number(row.sold_quantity),
        remainingQuantity: Number(row.remaining_quantity),
      }, input.quantity);
    } catch (validationError) {
      throw new DomainError(validationError instanceof Error ? validationError.message : "This sale exceeds the remaining stock.");
    }

    const calculation = calculateSale({
      quantity: input.quantity,
      currentProgress: Number(row.normal_sales_completed),
      currentCycle: Number(row.cycle_number),
      rule: {
        sellingPricePaise: Number(row.selling_price_paise),
        normalCommissionPaise: Number(row.normal_commission_paise),
        fullCommissionPaise: Number(row.full_commission_paise),
        rewardThreshold: Number(row.reward_threshold),
      },
    });
    const saleId = crypto.randomUUID();
    const productName = String(row.name);
    await db.batch([
      db.prepare(`UPDATE day_stock_items
        SET sold_quantity = sold_quantity + ?, remaining_quantity = remaining_quantity - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`).bind(input.quantity, input.quantity, row.stock_item_id),
      db.prepare(`INSERT INTO sales
        (id, idempotency_key, product_id, product_name, quantity, unit_price_paise, normal_commission_paise,
        full_commission_paise, reward_threshold, normal_units, full_units, gross_sales_paise,
        total_normal_commission_paise, total_full_commission_paise, total_earnings_paise, net_collection_paise)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(saleId, input.idempotencyKey, input.productId, productName, input.quantity,
          Number(row.selling_price_paise), Number(row.normal_commission_paise), Number(row.full_commission_paise),
          Number(row.reward_threshold), calculation.normalUnits, calculation.fullUnits, calculation.grossSalesPaise,
          calculation.totalNormalCommissionPaise, calculation.totalFullCommissionPaise,
          calculation.totalEarningsPaise, calculation.netCollectionPaise),
      db.prepare("INSERT INTO day_session_sales (sale_id, day_session_id, business_date) VALUES (?, ?, ?)")
        .bind(saleId, session.id, session.business_date),
      db.prepare(`UPDATE commission_progress
        SET normal_sales_completed = ?, cycle_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?`).bind(calculation.finalProgress, calculation.finalCycle, input.productId),
      ...calculation.fullCommissionCycles.map((cycleNumber) => db.prepare(
        `INSERT INTO full_commission_rewards (id, sale_id, product_id, product_name, cycle_number, amount_paise)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), saleId, input.productId, productName, cycleNumber, Number(row.full_commission_paise))),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'sale.created', 'sale', ?, ?)`)
        .bind(crypto.randomUUID(), saleId, JSON.stringify({
          daySessionId: session.id,
          productId: input.productId,
          quantity: input.quantity,
        })),
    ]);
    return { saleId, calculation, duplicate: false };
  }

  async markOfferReceived(rewardId: string): Promise<void> {
    const db = await ensureDatabase();
    await db.prepare("UPDATE full_commission_rewards SET status = 'received' WHERE id = ?").bind(rewardId);
  }

  async undoOfferReceived(rewardId: string): Promise<void> {
    const db = await ensureDatabase();
    await db.prepare("UPDATE full_commission_rewards SET status = 'earned' WHERE id = ?").bind(rewardId);
  }
}

export class D1SettingsRepository implements SettingsRepository {
  async getSettings(): Promise<AppSettings> {
    const db = await ensureDatabase();
    const settingsRow = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    return {
      salesmanName: String(settingsRow?.salesman_name ?? "Salesman"),
      businessName: String(settingsRow?.business_name ?? "AL QUWWA"),
      whatsappNumber: String(settingsRow?.whatsapp_number ?? ""),
      currency: String(settingsRow?.currency ?? "INR"),
      locale: String(settingsRow?.locale ?? "en-IN"),
      timezone: String(settingsRow?.timezone ?? DEFAULT_BUSINESS_TIMEZONE),
      realtimeEnabled: Number(settingsRow?.realtime_enabled ?? 1) === 1,
    };
  }
  
  async updateSettings(settings: Partial<AppSettings>): Promise<void> {
    const db = await ensureDatabase();
    await db.batch([
      db.prepare(`UPDATE settings SET salesman_name = ?, business_name = ?, whatsapp_number = ?, realtime_enabled = ? WHERE id = 'default'`)
        .bind(settings.salesmanName, settings.businessName, settings.whatsappNumber, settings.realtimeEnabled ? 1 : 0),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'settings.updated', 'settings', 'default', '{}')`).bind(crypto.randomUUID()),
    ]);
  }
}

export class D1StateRepository implements StateRepository {
  async getTrackerState(filter?: DateFilterOptions): Promise<TrackerState> {
    const db = await ensureDatabase();
    const settingsRow = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const settings: AppSettings = {
      salesmanName: String(settingsRow?.salesman_name ?? "Salesman"),
      businessName: String(settingsRow?.business_name ?? "AL QUWWA"),
      whatsappNumber: String(settingsRow?.whatsapp_number ?? ""),
      currency: String(settingsRow?.currency ?? "INR"),
      locale: String(settingsRow?.locale ?? "en-IN"),
      timezone: String(settingsRow?.timezone ?? DEFAULT_BUSINESS_TIMEZONE),
      realtimeEnabled: Number(settingsRow?.realtime_enabled ?? 1) === 1,
    };
    const time = await getDatabaseTime(settings.timezone);
    const sessionsResult = await db.prepare(
      "SELECT id, business_date, status FROM day_sessions ORDER BY business_date DESC"
    ).all<Row>();
    const sessions = sessionsResult.results.map((row) => ({
      id: String(row.id),
      businessDate: String(row.business_date),
      status: String(row.status) as "OPEN" | "CLOSED",
    }));
    const decision = getCurrentBusinessDayStateUseCase(time.businessDate, sessions);
    const datedSession = decision.sessionId
      ? await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(decision.sessionId).first<Row>()
      : null;

    let daySession: DaySession | null = null;
    let sales: SaleRecord[] = [];
    let rewards: Array<{ id: string; saleId: string; productName: string; cycleNumber: number; amountPaise: number; status: 'EARNED' | 'RECEIVED'; createdAt: string }> = [];
    let dayCloseSnapshot: DayCloseSnapshot | null = null;

    if (datedSession) {
      const sessionId = String(datedSession.id);
      const [stockResult, salesResult, rewardsResult, reopenCountRow, snapshotRow] = await Promise.all([
        db.prepare("SELECT * FROM day_stock_items WHERE day_session_id = ? ORDER BY product_name_snapshot")
          .bind(sessionId).all<Row>(),
        db.prepare(`SELECT s.* FROM sales s JOIN day_session_sales dss ON dss.sale_id = s.id
          WHERE dss.day_session_id = ? ORDER BY s.created_at DESC LIMIT 100`).bind(sessionId).all<Row>(),
        db.prepare(`SELECT r.* FROM full_commission_rewards r
          JOIN day_session_sales dss ON dss.sale_id = r.sale_id
          WHERE dss.day_session_id = ? ORDER BY r.created_at DESC LIMIT 100`).bind(sessionId).all<Row>(),
        db.prepare("SELECT COUNT(*) AS reopen_count FROM day_reopens WHERE day_session_id = ?").bind(sessionId).first<Row>(),
        db.prepare(`SELECT * FROM day_close_snapshots
          WHERE day_session_id = ? ORDER BY closure_version DESC LIMIT 1`).bind(sessionId).first<Row>(),
      ]);
      sales = salesResult.results.map(saleFromRow);
      rewards = rewardsResult.results.map((row: Row) => ({
        id: String(row.id),
        saleId: String(row.sale_id),
        productName: String(row.product_name),
        cycleNumber: Number(row.cycle_number),
        amountPaise: Number(row.amount_paise),
        status: (row.status as 'EARNED' | 'RECEIVED') || 'EARNED',
        createdAt: String(row.created_at),
      }));
      daySession = {
        id: sessionId,
        businessDate: String(datedSession.business_date),
        status: String(datedSession.status) as "OPEN" | "CLOSED",
        startedAt: isoTimestamp(datedSession.started_at),
        closedAt: datedSession.closed_at ? isoTimestamp(datedSession.closed_at) : null,
        reopenCount: Number(reopenCountRow?.reopen_count ?? 0),
        expenses: [],
        stockItems: stockResult.results.map((row: Row) => ({
          id: String(row.id),
          productId: String(row.product_id),
          productName: String(row.product_name_snapshot),
          unitPricePaise: Number(row.unit_price_paise_snapshot),
          pickedQuantity: Number(row.picked_quantity),
          soldQuantity: Number(row.sold_quantity),
          remainingQuantity: Number(row.remaining_quantity),
        })),
      };
      if (snapshotRow) {
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

    const [productsResult, historyResult, closuresResult] = await Promise.all([
      db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number
        FROM products p JOIN commission_progress cp ON cp.product_id = p.id
        WHERE p.active = 1 ORDER BY p.sort_order`).all<Row>(),
      db.prepare(`SELECT s.*, dss.business_date FROM sales s
        JOIN day_session_sales dss ON dss.sale_id = s.id
        ORDER BY s.created_at DESC LIMIT 250`).all<Row>(),
      db.prepare(`SELECT * FROM day_close_snapshots WHERE status = 'ACTIVE' ORDER BY business_date DESC LIMIT 100`).all<Row>(),
    ]);
    const historySales = historyResult.results.map((row) => ({
      ...saleFromRow(row),
      businessDate: String(row.business_date),
    }));
    const historyClosures = closuresResult.results.map((row) => ({
      id: String(row.id),
      businessDate: String(row.business_date),
      closureVersion: Number(row.closure_version),
      status: String(row.status) as "ACTIVE" | "SUPERSEDED",
      reportText: String(row.report_text),
      whatsappReportStatus: String(row.whatsapp_report_status) as "CURRENT" | "OUTDATED",
      createdAt: isoTimestamp(row.created_at),
    }));
    const status = ({
      NEW_DAY: "NOT_STARTED",
      CURRENT_OPEN: "OPEN",
      CURRENT_CLOSED: "CLOSED",
      PREVIOUS_OPEN: "PREVIOUS_DAY_STILL_OPEN",
    } satisfies Record<typeof decision.openingState, DaySessionStatus>)[decision.openingState];
    const laterSessionExists = daySession
      ? sessions.some((session) => session.businessDate > daySession.businessDate)
      : false;
    const reopenEligibility = daySession
      ? reopenBusinessDayUseCase({
        trustedBusinessDate: time.businessDate,
        target: daySession,
        laterSessionExists,
        hasPermission: true,
      })
      : { allowed: false, reason: "No closed Business Day is available." };

    return {
      products: productsResult.results.map((row: Row) => ({
        id: String(row.id),
        name: String(row.name),
        sellingPricePaise: Number(row.selling_price_paise),
        normalCommissionPaise: Number(row.normal_commission_paise),
        fullCommissionPaise: Number(row.full_commission_paise),
        rewardThreshold: Number(row.reward_threshold),
        progress: Number(row.normal_sales_completed),
        cycleNumber: Number(row.cycle_number),
      })),
      dashboard: summarizeSales(sales),
      sales,
      rewards,
      settings,
      isDayClosed: status === "CLOSED",
      time: {
        serverTime: time.serverTimeIso,
        businessDate: time.businessDate,
        timezone: time.timezone,
      },
      daySession,
      daySessionStatus: status,
      openingState: decision.openingState,
      dayCloseSnapshot,
      reopenEligibility,
      resetEligibility: daySession
        ? canResetBusinessDayUseCase({
          target: daySession,
          laterSessionExists,
          hasPermission: true,
        })
        : { allowed: false, reason: "No closed Business Day is available." },
      historySales,
      historyClosures,
      expenses: [],
      lastUpdatedAt: time.serverTimeIso,
    };
  }

  async getTrustedTime(): Promise<TrustedTimeState> {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    return {
      serverTime: time.serverTimeIso,
      businessDate: time.businessDate,
      timezone: time.timezone,
    };
  }
}

import type { AppSettings, DayCloseSnapshot, DaySession, DaySessionStatus, SaleRecord } from "../../../src/application/contracts";
import { getCurrentBusinessDayStateUseCase, reopenBusinessDayUseCase } from "../../../src/application/business-day-use-cases";
import { summarizeSales } from "../../../src/application/summary";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime, parseDatabaseTimestamp } from "../../../src/infrastructure/d1/database";

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

export async function GET() {
  try {
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
    let rewards: Array<{ id: string; saleId: string; productName: string; cycleNumber: number; amountPaise: number; createdAt: string }> = [];
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
        createdAt: isoTimestamp(row.created_at),
      }));
      daySession = {
        id: sessionId,
        businessDate: String(datedSession.business_date),
        status: String(datedSession.status) as "OPEN" | "CLOSED",
        startedAt: isoTimestamp(datedSession.started_at),
        closedAt: datedSession.closed_at ? isoTimestamp(datedSession.closed_at) : null,
        reopenCount: Number(reopenCountRow?.reopen_count ?? 0),
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

    const [productsResult, historyResult] = await Promise.all([
      db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number
        FROM products p JOIN commission_progress cp ON cp.product_id = p.id
        WHERE p.active = 1 ORDER BY p.sort_order`).all<Row>(),
      db.prepare(`SELECT s.*, dss.business_date FROM sales s
        JOIN day_session_sales dss ON dss.sale_id = s.id
        ORDER BY s.created_at DESC LIMIT 250`).all<Row>(),
    ]);
    const historySales = historyResult.results.map((row) => ({
      ...saleFromRow(row),
      businessDate: String(row.business_date),
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

    return Response.json({
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
      historySales,
      lastUpdatedAt: time.serverTimeIso,
    });
  } catch (error) {
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

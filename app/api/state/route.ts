import type { AppSettings, SaleRecord } from "../../../src/application/contracts";
import { summarizeSales } from "../../../src/application/summary";
import { businessDate, ensureDatabase, friendlyDatabaseError } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

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
    createdAt: String(row.created_at),
  };
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    const settingsRow = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const settings: AppSettings = {
      salesmanName: String(settingsRow?.salesman_name ?? "Salesman"),
      businessName: String(settingsRow?.business_name ?? "Sales Commission"),
      whatsappNumber: String(settingsRow?.whatsapp_number ?? ""),
      currency: String(settingsRow?.currency ?? "INR"),
      locale: String(settingsRow?.locale ?? "en-IN"),
      timezone: String(settingsRow?.timezone ?? "Asia/Kolkata"),
      realtimeEnabled: Number(settingsRow?.realtime_enabled ?? 1) === 1,
    };
    const today = businessDate(settings.timezone);
    const [productsResult, salesResult, rewardsResult, closure] = await Promise.all([
      db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number
        FROM products p JOIN commission_progress cp ON cp.product_id = p.id
        WHERE p.active = 1 ORDER BY p.sort_order`).all<Row>(),
      db.prepare("SELECT * FROM sales WHERE date(created_at, '+5 hours', '+30 minutes') = ? ORDER BY created_at DESC LIMIT 100").bind(today).all<Row>(),
      db.prepare("SELECT * FROM full_commission_rewards ORDER BY created_at DESC LIMIT 100").all<Row>(),
      db.prepare("SELECT id FROM day_closures WHERE business_date = ?").bind(today).first<Row>(),
    ]);
    const sales = salesResult.results.map(saleFromRow);
    return Response.json({
      products: productsResult.results.map((row: Row) => ({
        id: String(row.id), name: String(row.name), sellingPricePaise: Number(row.selling_price_paise),
        normalCommissionPaise: Number(row.normal_commission_paise), fullCommissionPaise: Number(row.full_commission_paise),
        rewardThreshold: Number(row.reward_threshold), progress: Number(row.normal_sales_completed), cycleNumber: Number(row.cycle_number),
      })),
      dashboard: summarizeSales(sales),
      sales,
      rewards: rewardsResult.results.map((row: Row) => ({
        id: String(row.id), saleId: String(row.sale_id), productName: String(row.product_name),
        cycleNumber: Number(row.cycle_number), amountPaise: Number(row.amount_paise), createdAt: String(row.created_at),
      })),
      settings,
      isDayClosed: Boolean(closure),
    });
  } catch (error) {
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

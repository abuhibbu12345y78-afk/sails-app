import { z } from "zod";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { calculateSale } from "../../../src/domain/commission";
import { validateDailySale } from "../../../src/domain/day-session";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime } from "../../../src/infrastructure/d1/database";

const saleSchema = z.object({
  productId: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(999),
  idempotencyKey: z.string().uuid(),
});

type Row = Record<string, string | number | null>;

export async function POST(request: Request) {
  try {
    const input = saleSchema.parse(await request.json());
    const db = await ensureDatabase();
    const duplicate = await db.prepare("SELECT id FROM sales WHERE idempotency_key = ?").bind(input.idempotencyKey).first<Row>();
    if (duplicate) return Response.json({ saleId: duplicate.id, duplicate: true });

    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE status = 'OPEN' LIMIT 1").first<Row>();
    if (!session) return Response.json({ error: "Start the business day before recording sales." }, { status: 409 });
    if (String(session.business_date) !== time.businessDate) {
      return Response.json({
        error: `The calendar date changed. Close ${session.business_date} before recording new sales.`,
      }, { status: 409 });
    }

    const row = await db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number,
      dsi.picked_quantity, dsi.sold_quantity, dsi.remaining_quantity, dsi.id AS stock_item_id
      FROM products p
      JOIN commission_progress cp ON cp.product_id = p.id
      JOIN day_stock_items dsi ON dsi.product_id = p.id AND dsi.day_session_id = ?
      WHERE p.id = ? AND p.active = 1`)
      .bind(session.id, input.productId).first<Row>();
    if (!row) return Response.json({ error: "This product is unavailable for the open day." }, { status: 404 });
    try {
      validateDailySale({
        productId: input.productId,
        pickedQuantity: Number(row.picked_quantity),
        soldQuantity: Number(row.sold_quantity),
        remainingQuantity: Number(row.remaining_quantity),
      }, input.quantity);
    } catch (validationError) {
      return Response.json({
        error: validationError instanceof Error ? validationError.message : "This sale exceeds the remaining stock.",
      }, { status: 409 });
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
    return Response.json({ saleId, calculation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose a valid product and quantity." }, { status: 400 });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

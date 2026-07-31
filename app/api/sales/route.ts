import { z } from "zod";
import { calculateSale } from "../../../src/domain/commission";
import { businessDate, ensureDatabase, friendlyDatabaseError } from "../../../src/infrastructure/d1/database";

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
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<Row>();
    const today = businessDate(String(settings?.timezone ?? "Asia/Kolkata"));
    const closed = await db.prepare("SELECT id FROM day_closures WHERE business_date = ?").bind(today).first<Row>();
    if (closed) return Response.json({ error: "Today is already closed. A new sale cannot be added." }, { status: 409 });
    const duplicate = await db.prepare("SELECT id FROM sales WHERE idempotency_key = ?").bind(input.idempotencyKey).first<Row>();
    if (duplicate) return Response.json({ saleId: duplicate.id, duplicate: true });

    const row = await db.prepare(`SELECT p.*, cp.normal_sales_completed, cp.cycle_number
      FROM products p JOIN commission_progress cp ON cp.product_id = p.id
      WHERE p.id = ? AND p.active = 1`).bind(input.productId).first<Row>();
    if (!row) return Response.json({ error: "This product is unavailable." }, { status: 404 });

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
    const statements = [
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
      db.prepare(`UPDATE commission_progress SET normal_sales_completed = ?, cycle_number = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?`).bind(calculation.finalProgress, calculation.finalCycle, input.productId),
      ...calculation.fullCommissionCycles.map((cycleNumber) => db.prepare(
        `INSERT INTO full_commission_rewards (id, sale_id, product_id, product_name, cycle_number, amount_paise)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), saleId, input.productId, productName, cycleNumber, Number(row.full_commission_paise))),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'sale.created', 'sale', ?, ?)`)
        .bind(crypto.randomUUID(), saleId, JSON.stringify({ productId: input.productId, quantity: input.quantity })),
    ];
    await db.batch(statements);
    return Response.json({ saleId, calculation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose a valid product and quantity." }, { status: 400 });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

import { z } from "zod";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime, parseDatabaseTimestamp } from "../../../src/infrastructure/d1/database";

const startDaySchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1).max(80),
    pickedQuantity: z.number().int().min(0).max(9999),
  })).max(100),
});

type Row = Record<string, string | number | null>;

export async function POST(request: Request) {
  try {
    const input = startDaySchema.parse(await request.json());
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const openSession = await db.prepare("SELECT business_date FROM day_sessions WHERE status = 'OPEN' LIMIT 1").first<Row>();
    if (openSession) {
      return Response.json({
        error: String(openSession.business_date) < time.businessDate
          ? `Close ${openSession.business_date} before starting ${time.businessDate}.`
          : "The business day is already open.",
      }, { status: 409 });
    }
    const existing = await db.prepare("SELECT status FROM day_sessions WHERE business_date = ?").bind(time.businessDate).first<Row>();
    if (existing) return Response.json({ error: "This business date has already been started." }, { status: 409 });

    const productResult = await db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY sort_order").all<Row>();
    const quantities = new Map(input.items.map((item) => [item.productId, item.pickedQuantity]));
    const validIds = new Set(productResult.results.map((row) => String(row.id)));
    if (input.items.some((item) => !validIds.has(item.productId))) {
      return Response.json({ error: "One or more selected products are unavailable." }, { status: 400 });
    }

    const sessionId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO day_sessions (id, business_date, status) VALUES (?, ?, 'OPEN')")
        .bind(sessionId, time.businessDate),
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
    return Response.json({ id: sessionId, businessDate: time.businessDate, startedAt }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the picked quantities and try again." }, { status: 400 });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

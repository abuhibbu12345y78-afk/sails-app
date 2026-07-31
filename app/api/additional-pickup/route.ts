import { z } from "zod";
import { previewAdditionalPickupUseCase } from "../../../src/application/business-day-use-cases";
import type { DayStockItem } from "../../../src/application/contracts";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

const pickupSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
  items: z.array(z.object({
    productId: z.string().min(1).max(80),
    additionalQuantity: z.number().int().min(0).max(9999),
  })).min(1).max(100),
}).refine((input) => new Set(input.items.map((item) => item.productId)).size === input.items.length, {
  message: "Each product may appear only once.",
});

export async function POST(request: Request) {
  try {
    const input = pickupSchema.parse(await request.json());
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(input.sessionId).first<Row>();
    if (!session || session.status !== "OPEN") {
      return Response.json({ error: "The reopened Business Day is no longer open." }, { status: 409 });
    }
    if (String(session.business_date) !== time.businessDate) {
      return Response.json({ error: "Additional pickup is allowed only for the trusted current Business Date." }, { status: 409 });
    }
    const reopened = await db.prepare("SELECT id FROM day_reopens WHERE day_session_id = ? ORDER BY reopen_count DESC LIMIT 1")
      .bind(input.sessionId).first<Row>();
    if (!reopened) return Response.json({ error: "Reopen the current Business Day before adding pickup." }, { status: 409 });

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
    if (input.items.some((item) => !activeIds.has(item.productId))) {
      return Response.json({ error: "One or more products are unavailable." }, { status: 400 });
    }
    const preview = previewAdditionalPickupUseCase(stockItems, input.items);
    if (preview.totalAdditionalUnits < 1) {
      return Response.json({ error: "Choose at least one additional unit." }, { status: 400 });
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
    return Response.json({
      sessionId: input.sessionId,
      totalAdditionalUnits: preview.totalAdditionalUnits,
      items: preview.items,
      createdAt: time.serverTimeIso,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the additional pickup quantities and reason." }, { status: 400 });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

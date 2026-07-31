import { z } from "zod";
import { ensureDatabase, friendlyDatabaseError } from "../../../src/infrastructure/d1/database";

const settingsSchema = z.object({
  salesmanName: z.string().trim().min(1).max(80),
  businessName: z.string().trim().min(1).max(120),
  whatsappNumber: z.string().trim().regex(/^\+?[0-9]{0,15}$/),
  realtimeEnabled: z.boolean(),
});

export async function PUT(request: Request) {
  try {
    const input = settingsSchema.parse(await request.json());
    const db = await ensureDatabase();
    await db.batch([
      db.prepare(`UPDATE settings SET salesman_name = ?, business_name = ?, whatsapp_number = ?, realtime_enabled = ? WHERE id = 'default'`)
        .bind(input.salesmanName, input.businessName, input.whatsappNumber, input.realtimeEnabled ? 1 : 0),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'settings.updated', 'settings', 'default', '{}')`).bind(crypto.randomUUID()),
    ]);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Check the settings and try again." }, { status: 400 });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime } from "../../../src/infrastructure/d1/database";

type Row = { timezone: string };

export async function GET() {
  try {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<Row>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    return Response.json({
      serverTime: time.serverTimeIso,
      businessDate: time.businessDate,
      timezone: time.timezone,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 503 });
  }
}

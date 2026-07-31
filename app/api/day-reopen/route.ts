import { z } from "zod";
import { reopenBusinessDayUseCase } from "../../../src/application/business-day-use-cases";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime, parseDatabaseTimestamp } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

const reopenSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().trim().min(8).max(300),
});

export async function POST(request: Request) {
  try {
    const input = reopenSchema.parse(await request.json());
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT timezone FROM settings WHERE id = 'default'").first<{ timezone: string }>();
    const time = await getDatabaseTime(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE);
    const session = await db.prepare("SELECT * FROM day_sessions WHERE id = ?").bind(input.sessionId).first<Row>();
    if (!session) return Response.json({ error: "The Business Day could not be found." }, { status: 404 });

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
    if (!eligibility.allowed) return Response.json({ error: eligibility.reason }, { status: 409 });
    if (otherOpen) return Response.json({ error: "Another Business Day is already open." }, { status: 409 });
    if (!session.closed_at) return Response.json({ error: "The original closing time is unavailable." }, { status: 409 });

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
    if (!reopened?.updated_at) return Response.json({ error: "The Business Day state changed. Refresh and try again." }, { status: 409 });
    return Response.json({
      sessionId: input.sessionId,
      reopenCount,
      reopenedAt: parseDatabaseTimestamp(String(reopened.updated_at)).toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Enter a reopen reason of at least 8 characters." }, { status: 400 });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

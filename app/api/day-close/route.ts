import { z } from "zod";
import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { formatCurrency } from "../../../src/domain/commission";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime, parseDatabaseTimestamp } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

const closeDaySchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = closeDaySchema.parse(await request.json());
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const time = await getDatabaseTime(String(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE));
    const session = await db.prepare(
      "SELECT * FROM day_sessions WHERE id = ? AND status = 'OPEN'"
    ).bind(input.sessionId).first<Row>();
    if (!session) return Response.json({ error: "There is no open business day to close." }, { status: 409 });

    const sessionId = String(session.id);
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
    return Response.json({
      id: closureId,
      reportText,
      whatsappNumber: String(settings?.whatsapp_number ?? ""),
      closedAt,
      businessDate: String(session.business_date),
      closureVersion,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose the Business Day to close and try again." }, { status: 400 });
    }
    console.error("DAY_CLOSE_FAILED", error);
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

import { DEFAULT_BUSINESS_TIMEZONE } from "../../../src/domain/business-time";
import { formatCurrency } from "../../../src/domain/commission";
import { ensureDatabase, friendlyDatabaseError, getDatabaseTime, parseDatabaseTimestamp } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

export async function POST() {
  try {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const time = await getDatabaseTime(String(settings?.timezone ?? DEFAULT_BUSINESS_TIMEZONE));
    const session = await db.prepare("SELECT * FROM day_sessions WHERE status = 'OPEN' LIMIT 1").first<Row>();
    if (!session) return Response.json({ error: "There is no open business day to close." }, { status: 409 });

    const sessionId = String(session.id);
    const [totals, stockRows] = await Promise.all([
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
    ]);

    const reportText = [
      "Sales Summary",
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
      `Full Commission: ${formatCurrency(Number(totals?.full_commission ?? 0))}`,
      `Total Earnings: ${formatCurrency(Number(totals?.earnings ?? 0))}`,
      `Net Collection: ${formatCurrency(Number(totals?.net ?? 0))}`,
    ].join("\n");
    const closureId = crypto.randomUUID();

    await db.batch([
      db.prepare(`UPDATE day_sessions
        SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'OPEN'`).bind(sessionId),
      db.prepare(`INSERT INTO day_closures
        (id, business_date, total_units, gross_sales_paise, total_normal_commission_paise,
        total_full_commission_paise, total_earnings_paise, net_collection_paise, report_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(closureId, session.business_date, Number(totals?.total_units ?? 0), Number(totals?.gross ?? 0),
          Number(totals?.normal ?? 0), Number(totals?.full_commission ?? 0), Number(totals?.earnings ?? 0),
          Number(totals?.net ?? 0), reportText),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.closed', 'day_session', ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, JSON.stringify({
          businessDate: session.business_date,
          serverTime: time.serverTimeIso,
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
    }, { status: 201 });
  } catch (error) {
    console.error("DAY_CLOSE_FAILED", error);
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

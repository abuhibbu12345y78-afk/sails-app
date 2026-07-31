import { formatCurrency } from "../../../src/domain/commission";
import { businessDate, ensureDatabase, friendlyDatabaseError } from "../../../src/infrastructure/d1/database";

type Row = Record<string, string | number | null>;

export async function POST() {
  try {
    const db = await ensureDatabase();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 'default'").first<Row>();
    const timezone = String(settings?.timezone ?? "Asia/Kolkata");
    const date = businessDate(timezone);
    const existing = await db.prepare("SELECT id FROM day_closures WHERE business_date = ?").bind(date).first<Row>();
    if (existing) return Response.json({ error: "This day has already been closed." }, { status: 409 });
    const totals = await db.prepare(`SELECT COALESCE(SUM(quantity),0) total_units,
      COALESCE(SUM(gross_sales_paise),0) gross, COALESCE(SUM(total_normal_commission_paise),0) normal,
      COALESCE(SUM(total_full_commission_paise),0) full, COALESCE(SUM(total_earnings_paise),0) earnings,
      COALESCE(SUM(net_collection_paise),0) net FROM sales WHERE date(created_at, '+5 hours', '+30 minutes') = ?`).bind(date).first<Row>();
    const productRows = await db.prepare(`SELECT product_name, SUM(quantity) quantity FROM sales
      WHERE date(created_at, '+5 hours', '+30 minutes') = ? GROUP BY product_name ORDER BY product_name`).bind(date).all<Row>();
    const reportText = [
      "Sales Summary", "", `Date: ${date}`, "", "Product-wise Sales",
      ...(productRows.results.length ? productRows.results.map((row: Row) => `• ${row.product_name} — ${row.quantity}`) : ["• No sales recorded"]),
      "", `Gross Sales: ${formatCurrency(Number(totals?.gross ?? 0))}`,
      `Normal Commission: ${formatCurrency(Number(totals?.normal ?? 0))}`,
      `Full Commission: ${formatCurrency(Number(totals?.full ?? 0))}`,
      `Total Earnings: ${formatCurrency(Number(totals?.earnings ?? 0))}`,
      `Net Collection: ${formatCurrency(Number(totals?.net ?? 0))}`,
    ].join("\n");
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare(`INSERT INTO day_closures
        (id, business_date, total_units, gross_sales_paise, total_normal_commission_paise,
        total_full_commission_paise, total_earnings_paise, net_collection_paise, report_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, date, Number(totals?.total_units ?? 0), Number(totals?.gross ?? 0), Number(totals?.normal ?? 0),
          Number(totals?.full ?? 0), Number(totals?.earnings ?? 0), Number(totals?.net ?? 0), reportText),
      db.prepare(`INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata_json)
        VALUES (?, 'day.closed', 'day_closure', ?, ?)`).bind(crypto.randomUUID(), id, JSON.stringify({ date })),
    ]);
    return Response.json({ id, reportText, whatsappNumber: String(settings?.whatsapp_number ?? "") }, { status: 201 });
  } catch (error) {
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sellingPricePaise: integer("selling_price_paise").notNull(),
  normalCommissionPaise: integer("normal_commission_paise").notNull(),
  fullCommissionPaise: integer("full_commission_paise").notNull(),
  rewardThreshold: integer("reward_threshold").notNull().default(12),
  sortOrder: integer("sort_order").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const commissionProgress = sqliteTable("commission_progress", {
  productId: text("product_id").primaryKey().references(() => products.id),
  normalSalesCompleted: integer("normal_sales_completed").notNull().default(0),
  cycleNumber: integer("cycle_number").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const daySessions = sqliteTable("day_sessions", {
  id: text("id").primaryKey(),
  businessDate: text("business_date").notNull().unique(),
  status: text("status", { enum: ["OPEN", "CLOSED"] }).notNull(),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("one_open_day_session_idx").on(table.status).where(sql`${table.status} = 'OPEN'`),
  check("day_session_status_check", sql`${table.status} IN ('OPEN','CLOSED')`),
  check("day_session_closed_at_check", sql`
    (${table.status} = 'OPEN' AND ${table.closedAt} IS NULL) OR
    (${table.status} = 'CLOSED' AND ${table.closedAt} IS NOT NULL)
  `),
]);

export const daySessionScopes = sqliteTable("day_session_scopes", {
  daySessionId: text("day_session_id").primaryKey().references(() => daySessions.id),
  tenantId: text("tenant_id").notNull().default("default"),
  companyId: text("company_id").notNull().default("default"),
  salesmanId: text("salesman_id").notNull().default("default"),
  businessDate: text("business_date").notNull(),
}, (table) => [
  uniqueIndex("day_session_scope_business_date_idx")
    .on(table.tenantId, table.companyId, table.salesmanId, table.businessDate),
]);

export const dayStockItems = sqliteTable("day_stock_items", {
  id: text("id").primaryKey(),
  daySessionId: text("day_session_id").notNull().references(() => daySessions.id),
  productId: text("product_id").notNull().references(() => products.id),
  pickedQuantity: integer("picked_quantity").notNull(),
  soldQuantity: integer("sold_quantity").notNull().default(0),
  remainingQuantity: integer("remaining_quantity").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  unitPricePaiseSnapshot: integer("unit_price_paise_snapshot").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("day_stock_session_product_idx").on(table.daySessionId, table.productId),
  check("day_stock_picked_check", sql`${table.pickedQuantity} >= 0`),
  check("day_stock_sold_check", sql`${table.soldQuantity} >= 0 AND ${table.soldQuantity} <= ${table.pickedQuantity}`),
  check("day_stock_remaining_check", sql`${table.remainingQuantity} >= 0 AND ${table.remainingQuantity} = ${table.pickedQuantity} - ${table.soldQuantity}`),
]);

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPricePaise: integer("unit_price_paise").notNull(),
  normalCommissionPaise: integer("normal_commission_paise").notNull(),
  fullCommissionPaise: integer("full_commission_paise").notNull(),
  rewardThreshold: integer("reward_threshold").notNull(),
  normalUnits: integer("normal_units").notNull(),
  fullUnits: integer("full_units").notNull(),
  grossSalesPaise: integer("gross_sales_paise").notNull(),
  totalNormalCommissionPaise: integer("total_normal_commission_paise").notNull(),
  totalFullCommissionPaise: integer("total_full_commission_paise").notNull(),
  totalEarningsPaise: integer("total_earnings_paise").notNull(),
  netCollectionPaise: integer("net_collection_paise").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("sales_idempotency_key_idx").on(table.idempotencyKey),
]);

export const daySessionSales = sqliteTable("day_session_sales", {
  saleId: text("sale_id").primaryKey().references(() => sales.id),
  daySessionId: text("day_session_id").notNull().references(() => daySessions.id),
  businessDate: text("business_date").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("day_session_sales_session_idx").on(table.daySessionId, table.createdAt),
]);

export const fullCommissionRewards = sqliteTable("full_commission_rewards", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull().references(() => sales.id),
  productId: text("product_id").notNull().references(() => products.id),
  productName: text("product_name").notNull(),
  cycleNumber: integer("cycle_number").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dayClosures = sqliteTable("day_closures", {
  id: text("id").primaryKey(),
  businessDate: text("business_date").notNull().unique(),
  totalUnits: integer("total_units").notNull(),
  grossSalesPaise: integer("gross_sales_paise").notNull(),
  totalNormalCommissionPaise: integer("total_normal_commission_paise").notNull(),
  totalFullCommissionPaise: integer("total_full_commission_paise").notNull(),
  totalEarningsPaise: integer("total_earnings_paise").notNull(),
  netCollectionPaise: integer("net_collection_paise").notNull(),
  reportText: text("report_text").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dayCloseSnapshots = sqliteTable("day_close_snapshots", {
  id: text("id").primaryKey(),
  daySessionId: text("day_session_id").notNull().references(() => daySessions.id),
  businessDate: text("business_date").notNull(),
  closureVersion: integer("closure_version").notNull(),
  status: text("status", { enum: ["ACTIVE", "SUPERSEDED"] }).notNull().default("ACTIVE"),
  totalUnits: integer("total_units").notNull(),
  grossSalesPaise: integer("gross_sales_paise").notNull(),
  totalNormalCommissionPaise: integer("total_normal_commission_paise").notNull(),
  totalOfferEarningsPaise: integer("total_offer_earnings_paise").notNull(),
  totalEarningsPaise: integer("total_earnings_paise").notNull(),
  netCollectionPaise: integer("net_collection_paise").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  reportText: text("report_text").notNull(),
  whatsappReportStatus: text("whatsapp_report_status", { enum: ["CURRENT", "OUTDATED"] }).notNull().default("CURRENT"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("day_close_snapshot_version_idx").on(table.daySessionId, table.closureVersion),
  index("day_close_snapshot_active_idx").on(table.daySessionId, table.status),
]);

export const dayReopens = sqliteTable("day_reopens", {
  id: text("id").primaryKey(),
  daySessionId: text("day_session_id").notNull().references(() => daySessions.id),
  reopenCount: integer("reopen_count").notNull(),
  reopenReason: text("reopen_reason").notNull(),
  reopenedBy: text("reopened_by").notNull(),
  originalClosedAt: text("original_closed_at").notNull(),
  reopenedAt: text("reopened_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("day_reopen_count_idx").on(table.daySessionId, table.reopenCount),
]);

export const dayStockAdjustments = sqliteTable("day_stock_adjustments", {
  id: text("id").primaryKey(),
  daySessionId: text("day_session_id").notNull().references(() => daySessions.id),
  productId: text("product_id").notNull().references(() => products.id),
  adjustmentType: text("adjustment_type", { enum: ["ADDITIONAL_PICKUP"] }).notNull(),
  quantity: integer("quantity").notNull(),
  previousPickedQuantity: integer("previous_picked_quantity").notNull(),
  newPickedQuantity: integer("new_picked_quantity").notNull(),
  previousRemainingQuantity: integer("previous_remaining_quantity").notNull(),
  newRemainingQuantity: integer("new_remaining_quantity").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("day_stock_adjustment_session_idx").on(table.daySessionId, table.createdAt),
  check("day_stock_adjustment_quantity_check", sql`${table.quantity} > 0`),
]);

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("default"),
  salesmanName: text("salesman_name").notNull().default("Salesman"),
  businessName: text("business_name").notNull().default("Sales Commission"),
  whatsappNumber: text("whatsapp_number").notNull().default(""),
  currency: text("currency").notNull().default("INR"),
  locale: text("locale").notNull().default("en-IN"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  realtimeEnabled: integer("realtime_enabled", { mode: "boolean" }).notNull().default(true),
});

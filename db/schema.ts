import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

CREATE TABLE IF NOT EXISTS `day_session_scopes` (
  `day_session_id` text PRIMARY KEY NOT NULL,
  `tenant_id` text DEFAULT 'default' NOT NULL,
  `company_id` text DEFAULT 'default' NOT NULL,
  `salesman_id` text DEFAULT 'default' NOT NULL,
  `business_date` text NOT NULL,
  FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `day_session_scope_business_date_idx`
ON `day_session_scopes` (`tenant_id`,`company_id`,`salesman_id`,`business_date`);
--> statement-breakpoint
INSERT OR IGNORE INTO `day_session_scopes`
(`day_session_id`,`tenant_id`,`company_id`,`salesman_id`,`business_date`)
SELECT `id`,'default','default','default',`business_date` FROM `day_sessions`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `day_close_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `day_session_id` text NOT NULL,
  `business_date` text NOT NULL,
  `closure_version` integer NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL CHECK(`status` IN ('ACTIVE','SUPERSEDED')),
  `total_units` integer NOT NULL,
  `gross_sales_paise` integer NOT NULL,
  `total_normal_commission_paise` integer NOT NULL,
  `total_offer_earnings_paise` integer NOT NULL,
  `total_earnings_paise` integer NOT NULL,
  `net_collection_paise` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `report_text` text NOT NULL,
  `whatsapp_report_status` text DEFAULT 'CURRENT' NOT NULL CHECK(`whatsapp_report_status` IN ('CURRENT','OUTDATED')),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `day_close_snapshot_version_idx`
ON `day_close_snapshots` (`day_session_id`,`closure_version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `day_close_snapshot_active_idx`
ON `day_close_snapshots` (`day_session_id`,`status`);
--> statement-breakpoint
INSERT OR IGNORE INTO `day_close_snapshots`
(`id`,`day_session_id`,`business_date`,`closure_version`,`status`,`total_units`,`gross_sales_paise`,
`total_normal_commission_paise`,`total_offer_earnings_paise`,`total_earnings_paise`,
`net_collection_paise`,`snapshot_json`,`report_text`,`whatsapp_report_status`,`created_at`)
SELECT dc.`id`,ds.`id`,dc.`business_date`,1,'ACTIVE',dc.`total_units`,dc.`gross_sales_paise`,
dc.`total_normal_commission_paise`,dc.`total_full_commission_paise`,dc.`total_earnings_paise`,
dc.`net_collection_paise`,'{"legacy":true}',dc.`report_text`,'CURRENT',dc.`created_at`
FROM `day_closures` dc JOIN `day_sessions` ds ON ds.`business_date` = dc.`business_date`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `day_reopens` (
  `id` text PRIMARY KEY NOT NULL,
  `day_session_id` text NOT NULL,
  `reopen_count` integer NOT NULL,
  `reopen_reason` text NOT NULL,
  `reopened_by` text NOT NULL,
  `original_closed_at` text NOT NULL,
  `reopened_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `day_reopen_count_idx`
ON `day_reopens` (`day_session_id`,`reopen_count`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `day_stock_adjustments` (
  `id` text PRIMARY KEY NOT NULL,
  `day_session_id` text NOT NULL,
  `product_id` text NOT NULL,
  `adjustment_type` text NOT NULL CHECK(`adjustment_type` = 'ADDITIONAL_PICKUP'),
  `quantity` integer NOT NULL CHECK(`quantity` > 0),
  `previous_picked_quantity` integer NOT NULL,
  `new_picked_quantity` integer NOT NULL,
  `previous_remaining_quantity` integer NOT NULL,
  `new_remaining_quantity` integer NOT NULL,
  `reason` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `day_stock_adjustment_session_idx`
ON `day_stock_adjustments` (`day_session_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;

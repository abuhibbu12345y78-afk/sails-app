CREATE TABLE `day_close_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`day_session_id` text NOT NULL,
	`business_date` text NOT NULL,
	`closure_version` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`total_units` integer NOT NULL,
	`gross_sales_paise` integer NOT NULL,
	`total_normal_commission_paise` integer NOT NULL,
	`total_offer_earnings_paise` integer NOT NULL,
	`total_earnings_paise` integer NOT NULL,
	`total_expenses_paise` integer DEFAULT 0 NOT NULL,
	`net_collection_paise` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`report_text` text NOT NULL,
	`whatsapp_report_status` text DEFAULT 'CURRENT' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_close_snapshot_version_idx` ON `day_close_snapshots` (`day_session_id`,`closure_version`);--> statement-breakpoint
CREATE INDEX `day_close_snapshot_active_idx` ON `day_close_snapshots` (`day_session_id`,`status`);--> statement-breakpoint
CREATE TABLE `day_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`day_session_id` text NOT NULL,
	`category` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `day_expenses_session_category_idx` ON `day_expenses` (`day_session_id`,`category`);--> statement-breakpoint
CREATE TABLE `day_reopens` (
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
CREATE UNIQUE INDEX `day_reopen_count_idx` ON `day_reopens` (`day_session_id`,`reopen_count`);--> statement-breakpoint
CREATE TABLE `day_session_scopes` (
	`day_session_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`company_id` text DEFAULT 'default' NOT NULL,
	`salesman_id` text DEFAULT 'default' NOT NULL,
	`business_date` text NOT NULL,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_session_scope_business_date_idx` ON `day_session_scopes` (`tenant_id`,`company_id`,`salesman_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `day_stock_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`day_session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`adjustment_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`previous_picked_quantity` integer NOT NULL,
	`new_picked_quantity` integer NOT NULL,
	`previous_remaining_quantity` integer NOT NULL,
	`new_remaining_quantity` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "day_stock_adjustment_quantity_check" CHECK("day_stock_adjustments"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `day_stock_adjustment_session_idx` ON `day_stock_adjustments` (`day_session_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `day_closures` ADD `total_expenses_paise` integer DEFAULT 0 NOT NULL;
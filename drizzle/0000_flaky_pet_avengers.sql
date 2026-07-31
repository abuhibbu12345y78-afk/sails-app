CREATE TABLE `commission_progress` (
	`product_id` text PRIMARY KEY NOT NULL,
	`normal_sales_completed` integer DEFAULT 0 NOT NULL,
	`cycle_number` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `day_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`total_units` integer NOT NULL,
	`gross_sales_paise` integer NOT NULL,
	`total_normal_commission_paise` integer NOT NULL,
	`total_full_commission_paise` integer NOT NULL,
	`total_earnings_paise` integer NOT NULL,
	`net_collection_paise` integer NOT NULL,
	`report_text` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_closures_business_date_unique` ON `day_closures` (`business_date`);--> statement-breakpoint
CREATE TABLE `full_commission_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`cycle_number` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`selling_price_paise` integer NOT NULL,
	`normal_commission_paise` integer NOT NULL,
	`full_commission_paise` integer NOT NULL,
	`reward_threshold` integer DEFAULT 12 NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_paise` integer NOT NULL,
	`normal_commission_paise` integer NOT NULL,
	`full_commission_paise` integer NOT NULL,
	`reward_threshold` integer NOT NULL,
	`normal_units` integer NOT NULL,
	`full_units` integer NOT NULL,
	`gross_sales_paise` integer NOT NULL,
	`total_normal_commission_paise` integer NOT NULL,
	`total_full_commission_paise` integer NOT NULL,
	`total_earnings_paise` integer NOT NULL,
	`net_collection_paise` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_idempotency_key_idx` ON `sales` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`salesman_name` text DEFAULT 'Salesman' NOT NULL,
	`business_name` text DEFAULT 'Sales Commission' NOT NULL,
	`whatsapp_number` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`locale` text DEFAULT 'en-IN' NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`realtime_enabled` integer DEFAULT true NOT NULL
);

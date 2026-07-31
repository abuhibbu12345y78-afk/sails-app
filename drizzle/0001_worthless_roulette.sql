CREATE TABLE `day_session_sales` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`day_session_id` text NOT NULL,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `day_session_sales_session_idx` ON `day_session_sales` (`day_session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `day_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_date` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "day_session_status_check" CHECK("day_sessions"."status" IN ('OPEN','CLOSED')),
	CONSTRAINT "day_session_closed_at_check" CHECK(
    ("day_sessions"."status" = 'OPEN' AND "day_sessions"."closed_at" IS NULL) OR
    ("day_sessions"."status" = 'CLOSED' AND "day_sessions"."closed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_sessions_business_date_unique` ON `day_sessions` (`business_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_open_day_session_idx` ON `day_sessions` (`status`) WHERE "day_sessions"."status" = 'OPEN';--> statement-breakpoint
CREATE TABLE `day_stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`day_session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`picked_quantity` integer NOT NULL,
	`sold_quantity` integer DEFAULT 0 NOT NULL,
	`remaining_quantity` integer NOT NULL,
	`product_name_snapshot` text NOT NULL,
	`unit_price_paise_snapshot` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`day_session_id`) REFERENCES `day_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "day_stock_picked_check" CHECK("day_stock_items"."picked_quantity" >= 0),
	CONSTRAINT "day_stock_sold_check" CHECK("day_stock_items"."sold_quantity" >= 0 AND "day_stock_items"."sold_quantity" <= "day_stock_items"."picked_quantity"),
	CONSTRAINT "day_stock_remaining_check" CHECK("day_stock_items"."remaining_quantity" >= 0 AND "day_stock_items"."remaining_quantity" = "day_stock_items"."picked_quantity" - "day_stock_items"."sold_quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_stock_session_product_idx` ON `day_stock_items` (`day_session_id`,`product_id`);